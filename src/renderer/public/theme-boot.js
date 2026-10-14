/* 首帧主题:必须在模块脚本之前同步执行,否则首帧按浅色令牌绘制,
   夜间用户会看到一次白闪。镜像键与取值同 src/renderer/src/data/theme.ts 的
   THEME_MIRROR_KEY(本脚本先于模块执行,import 不到它);
   权威记录是 preferences,启动后由 restoreUiPrefs() 校正并回写镜像。

   为什么是外部文件而不是 <script> 内联块:
   index.html 的 CSP 是 script-src 'self',内联块会被 script-src-elem 拦截并
   静默不执行,首帧于是退回浅色,表现就是「先浅色再变深色」。
   经典脚本(无 defer/async)在解析时阻塞渲染,首个绘制帧之前必然已执行,
   与原内联脚本的时序保证完全一致。改这里的键名必须同步改 theme.ts。 */
try {
  if (localStorage.getItem('mediahub.theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark')
  }
} catch (e) {
  /* 存储不可用时按浅色启动 */
}
