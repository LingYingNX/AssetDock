// 启动器:只在源码变过时构建,然后启动 out/ 产物
//
// 两个坑:
// 1. 应用运行时 Chromium 占着 out/renderer 的文件句柄,electron-vite 清空输出目录
//    会撞上 EPERM,构建失败。源码改了不重新构建等于没改,所以构建前要关掉旧实例。
// 2. 每次双击都构建毫无必要:源码没动就直接启动,秒开。
//
// 编译(仓库根目录执行):
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /codepage:65001 ^
//     /target:winexe /reference:System.Windows.Forms.dll /reference:System.Drawing.dll ^
//     /win32icon:build\icon.ico /out:启动.exe build\launcher\Launcher.cs
using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace AssetDockLauncher
{
    internal static class Launcher
    {
        private const string Title = "启动 AssetDock";

        /* 构建产物:三样都存在才算构建成功,取最早的时间戳当构建时间 */
        private static readonly string[] BuildOutputs =
        {
            Path.Combine("out", "main", "index.js"),
            Path.Combine("out", "preload", "index.js"),
            Path.Combine("out", "renderer", "index.html")
        };

        /* 改动这些文件也要重新构建 */
        private static readonly string[] ConfigFiles =
        {
            "package.json",
            "electron.vite.config.ts",
            "tsconfig.json",
            "tsconfig.node.json",
            "tsconfig.web.json",
            "vitest.config.mts"
        };

        private static string RepoDir
        {
            get { return AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar); }
        }

        [STAThread]
        private static int Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string repo = RepoDir;
            string electron = Path.Combine(Path.Combine(Path.Combine(repo, "node_modules"), "electron"),
                Path.Combine("dist", "electron.exe"));

            if (!File.Exists(electron))
            {
                MessageBox.Show("未找到 node_modules\\electron\\dist\\electron.exe\n请先运行 npm install",
                    Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }

            if (NeedsBuild(repo))
            {
                /* 实例不关就构建不动,先问一句,别替用户把正在用着的窗口杀掉 */
                if (HasRunning(electron))
                {
                    DialogResult answer = MessageBox.Show(
                        "检测到 AssetDock 正在运行。\n重新构建需要先关闭它,之后会启动新版本。\n\n继续吗?",
                        Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question);
                    if (answer != DialogResult.Yes) return 0;
                    StopRunning(electron);
                    if (HasRunning(electron))
                    {
                        MessageBox.Show("没能关闭正在运行的实例,请手动结束后重试。",
                            Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                        return 1;
                    }
                }

                int code = BuildWithProgress(repo);
                if (code != 0) return code;
            }

            StartApp(electron, repo);
            return 0;
        }

        /* 源码比构建产物新才需要构建;取产物最早时间戳,半截的构建会被当成过期 */
        private static bool NeedsBuild(string repo)
        {
            DateTime built = DateTime.MaxValue;
            foreach (string relative in BuildOutputs)
            {
                string path = Path.Combine(repo, relative);
                if (!File.Exists(path)) return true;
                DateTime stamp = File.GetLastWriteTimeUtc(path);
                if (stamp < built) built = stamp;
            }

            DateTime changed = NewestSourceTime(repo);
            return changed > built;
        }

        private static DateTime NewestSourceTime(string repo)
        {
            DateTime newest = DateTime.MinValue;
            foreach (string relative in ConfigFiles)
            {
                string path = Path.Combine(repo, relative);
                if (File.Exists(path))
                {
                    DateTime stamp = File.GetLastWriteTimeUtc(path);
                    if (stamp > newest) newest = stamp;
                }
            }

            string sourceRoot = Path.Combine(repo, "src");
            if (!Directory.Exists(sourceRoot)) return newest;
            try
            {
                foreach (string file in Directory.GetFiles(sourceRoot, "*", SearchOption.AllDirectories))
                {
                    DateTime stamp = File.GetLastWriteTimeUtc(file);
                    if (stamp > newest) newest = stamp;
                }
                /* 目录时间戳覆盖增删文件:文件被删掉但目录没动,光看文件列表是看不出来的 */
                foreach (string directory in Directory.GetDirectories(sourceRoot, "*", SearchOption.AllDirectories))
                {
                    DateTime stamp = Directory.GetLastWriteTimeUtc(directory);
                    if (stamp > newest) newest = stamp;
                }
            }
            catch
            {
                /* 读不到目录就按已有信息判断,别让扫描失败挡住启动 */
            }
            return newest;
        }

        /* 构建期间给一个进度窗:输出实时刷进去,失败时留在屏幕上给用户看 */
        private static int BuildWithProgress(string repo)
        {
            string log = Path.Combine(repo, "artifacts", "build-launch.log");
            BuildForm form = new BuildForm(log);
            int code = -1;

            Thread worker = new Thread(delegate()
            {
                code = RunBuild(repo, log, form);
                form.BeginInvoke(new MethodInvoker(delegate()
                {
                    if (code == 0) form.Close();
                    else form.ShowFailure(code);
                }));
            });
            worker.IsBackground = true;
            worker.Start();
            form.ShowDialog();
            worker.Join(2000);
            return code;
        }

        private static int RunBuild(string repo, string log, BuildForm form)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(log));
            using (StreamWriter writer = new StreamWriter(log, false, Encoding.UTF8))
            using (Process process = new Process())
            {
                ProcessStartInfo info = new ProcessStartInfo("cmd.exe", "/c npm run build");
                info.WorkingDirectory = repo;
                info.UseShellExecute = false;
                info.RedirectStandardOutput = true;
                info.RedirectStandardError = true;
                info.CreateNoWindow = true;
                /* npm 输出的是 UTF-8(✓ 这类符号),按系统 ANSI 解码会变乱码 */
                info.StandardOutputEncoding = new UTF8Encoding(false);
                info.StandardErrorEncoding = new UTF8Encoding(false);
                process.StartInfo = info;

                process.OutputDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data == null) return;
                    writer.WriteLine(e.Data);
                    writer.Flush();
                    form.AppendLine(e.Data);
                };
                process.ErrorDataReceived += delegate(object sender, DataReceivedEventArgs e)
                {
                    if (e.Data == null) return;
                    writer.WriteLine(e.Data);
                    writer.Flush();
                    form.AppendLine(e.Data);
                };

                process.Start();
                process.BeginOutputReadLine();
                process.BeginErrorReadLine();
                process.WaitForExit();
                /* 再等一次,等异步读取把最后几行收干净 */
                process.WaitForExit();
                return process.ExitCode;
            }
        }

        /* 仓库里的 electron 实例与已安装的 AssetDock 都占着单实例锁,两边都要放行 */
        private static bool HasRunning(string electronPath)
        {
            foreach (Process process in Process.GetProcessesByName("AssetDock"))
            {
                if (IsAlive(process)) return true;
            }
            foreach (Process process in Process.GetProcessesByName("electron"))
            {
                if (!IsAlive(process)) continue;
                try
                {
                    if (string.Equals(process.MainModule.FileName, electronPath, StringComparison.OrdinalIgnoreCase))
                        return true;
                }
                catch
                {
                    /* 别的用户的进程读不到路径,跳过 */
                }
            }
            return false;
        }

        private static void StopRunning(string electronPath)
        {
            foreach (Process process in Process.GetProcessesByName("AssetDock")) Kill(process);
            foreach (Process process in Process.GetProcessesByName("electron"))
            {
                try
                {
                    if (string.Equals(process.MainModule.FileName, electronPath, StringComparison.OrdinalIgnoreCase))
                        Kill(process);
                }
                catch
                {
                    /* 读不到路径的不管 */
                }
            }
            for (int i = 0; i < 40 && HasRunning(electronPath); i++) Thread.Sleep(200);
        }

        private static void Kill(Process process)
        {
            try
            {
                if (!process.HasExited) process.Kill();
            }
            catch
            {
                /* 进程可能刚好自己退了 */
            }
        }

        private static bool IsAlive(Process process)
        {
            try
            {
                return !process.HasExited;
            }
            catch
            {
                return false;
            }
        }

        /* 用 ShellExecute 启动:不继承控制台,启动器退出后窗口不会被一起带走 */
        private static void StartApp(string electron, string repo)
        {
            ProcessStartInfo info = new ProcessStartInfo(electron, ".");
            info.WorkingDirectory = repo;
            info.UseShellExecute = true;
            Process.Start(info);
        }
    }

    /* 构建进度窗:实时输出 + 失败时留在屏幕上 */
    internal sealed class BuildForm : Form
    {
        private const string Title = "启动 AssetDock";

        private readonly Label status;
        private readonly TextBox output;
        private readonly Button close;

        public BuildForm(string logPath)
        {
            Text = Title;
            StartPosition = FormStartPosition.CenterScreen;
            ClientSize = new Size(760, 420);
            MinimumSize = new Size(520, 300);
            TopMost = true;
            Font = new Font("Microsoft YaHei UI", 9F);

            status = new Label();
            status.Dock = DockStyle.Top;
            status.Height = 28;
            status.TextAlign = ContentAlignment.MiddleLeft;
            status.Padding = new Padding(10, 4, 10, 4);
            status.Text = "正在构建新版本…";

            output = new TextBox();
            output.Dock = DockStyle.Fill;
            output.Multiline = true;
            output.ReadOnly = true;
            output.ScrollBars = ScrollBars.Both;
            output.WordWrap = false;
            output.Font = new Font("Consolas", 9F);
            output.BackColor = Color.FromArgb(24, 26, 32);
            output.ForeColor = Color.Gainsboro;
            output.BorderStyle = BorderStyle.None;

            close = new Button();
            close.Dock = DockStyle.Bottom;
            close.Height = 32;
            close.Text = "确定";
            close.Visible = false;
            close.Click += delegate { Close(); };

            Controls.Add(output);
            Controls.Add(close);
            Controls.Add(status);
        }

        public void AppendLine(string line)
        {
            if (IsDisposed) return;
            try
            {
                BeginInvoke(new MethodInvoker(delegate()
                {
                    if (IsDisposed) return;
                    output.AppendText(line + Environment.NewLine);
                }));
            }
            catch
            {
                /* 窗体已经关了,忽略 */
            }
        }

        /* 构建失败:留住窗口,把日志路径给用户 */
        public void ShowFailure(int code)
        {
            if (IsDisposed) return;
            try
            {
                BeginInvoke(new MethodInvoker(delegate()
                {
                    if (IsDisposed) return;
                    status.Text = "构建失败 (exit " + code + "),应用未启动";
                    close.Visible = true;
                    close.BringToFront();
                }));
            }
            catch
            {
                /* 窗体已经关了,忽略 */
            }
        }
    }
}
