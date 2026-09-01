## Purpose

定义全局视觉基调:设计令牌、蓝色壁纸光斑、液态玻璃面板配方、SVG 折射滤镜与动效纪律,保证所有界面共享同一套玻璃质感。

## Requirements

### Requirement: 设计令牌与壁纸
应用 SHALL 按设计规格实现全部设计令牌(bg0–bg4、白色系描边 line/line2、文字 t1–t3、强调 acc 系、语义色、--colw、圆角、字体栈),body 背景为四组蓝色 radial 光斑 + 165° 线性渐变;基础字号 13px/行高 1.5,数字使用 tabular-nums;【禁止】任何小于 9px 的字号与深色描边。

#### Scenario: 壁纸透过玻璃
- **WHEN** 观察任意玻璃面板(侧栏、检查器、筛选条等)
- **THEN** 面板透出壁纸光斑的颜色变化,不同位置颜色不同

### Requirement: 玻璃面板配方
标题栏 / 工具栏 / 侧栏 / 检查器 / 筛选条 / 色带 / 菜单 SHALL 使用统一玻璃配方:斜向镜面高光渐变 + 蓝调基底 rgba(219,236,255,.24~.36);backdrop-filter 两条声明依次为 blur 回退版与 url(#liquid-lens) 折射版(顺序不可颠倒);边框为白色玻璃亮边;带上下缘 inset 高光与蓝调投影。素材卡片只使用 blur(18px) saturate(1.7) brightness(1.04),不挂折射滤镜。

#### Scenario: Chromium 折射
- **WHEN** 应用运行于 Chromium 内核(Electron)
- **THEN** 大面积面板背景经 liquid-lens 滤镜呈现折射扭曲;卡片缩略图滚动流畅无滤镜开销

### Requirement: 折射滤镜全局注册
liquid-lens 位移滤镜(feTurbulence + feGaussianBlur + feDisplacementMap,参数按规格)SHALL 在文档中全局注册一次,供各面板引用。

#### Scenario: 滤镜单例
- **WHEN** 检查页面 DOM
- **THEN** liquid-lens 滤镜定义仅存在一份,多个面板通过 url(#liquid-lens) 引用

### Requirement: 动效与可访问性
应用 SHALL 尊重 prefers-reduced-motion: reduce,全局禁用动画与过渡;所有可交互元素拥有焦点态 outline(2px solid --acc,offset 2px);浅玻璃上的正文文字使用 --t1/--t2 保证对比可读。

#### Scenario: 减少动态偏好
- **WHEN** 系统开启"减少动态效果"
- **THEN** 卡片上浮、缩略图缓放、立方体自转等动画全部停止,界面功能不受影响
