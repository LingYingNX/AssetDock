// 启动器:关掉正在运行的实例 → npm run build → 启动 out/ 产物
//
// 为什么必须先关实例:应用运行时 Chromium 持有 out/renderer 下的文件句柄,
// electron-vite 清空输出目录时会撞上 EPERM,构建失败、启动器弹错误框。
// 源码改了不重新构建就等于没改,所以这一步不能省。
//
// 编译(仓库根目录执行):
//   C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe /nologo /codepage:65001 ^
//     /reference:System.Windows.Forms.dll /win32icon:build\icon.ico ^
//     /out:启动.exe build\launcher\Launcher.cs
using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;

namespace AssetDockLauncher
{
    internal static class Launcher
    {
        private const string Title = "启动 AssetDock";

        private static string RepoDir
        {
            get { return AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar); }
        }

        [STAThread]
        private static int Main()
        {
            string repo = RepoDir;
            string electron = Path.Combine(Path.Combine(Path.Combine(repo, "node_modules"), "electron"),
                Path.Combine("dist", "electron.exe"));

            if (!File.Exists(electron))
            {
                MessageBox.Show("未找到 node_modules\\electron\\dist\\electron.exe\n请先运行 npm install",
                    Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }

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

            int code = RunBuild(repo);
            if (code != 0)
            {
                Console.WriteLine();
                Console.WriteLine("npm run build 失败 (exit {0})。", code);
                Console.WriteLine("按任意键关闭本窗口。");
                Console.ReadKey(true);
                return code;
            }

            StartApp(electron, repo);
            return 0;
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

        /* 继承当前控制台,构建日志直接打在启动器窗口里 */
        private static int RunBuild(string repo)
        {
            ProcessStartInfo info = new ProcessStartInfo("cmd.exe", "/c npm run build");
            info.WorkingDirectory = repo;
            info.UseShellExecute = false;
            using (Process process = Process.Start(info))
            {
                process.WaitForExit();
                return process.ExitCode;
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
}
