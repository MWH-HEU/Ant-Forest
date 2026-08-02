/*
 * 测试kill进程脚本
 * 手动打开应用后运行此脚本，检查是否真正关闭了进程
 * 日志输出到悬浮窗
 */

let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let LogFloaty = sRequire('LogFloaty')
let killProcessUtil = require('../lib/KillProcessUtil.js')

if (!killProcessUtil.isShizukuRunning()) {
  LogFloaty.pushLog('错误: Shizuku 未运行，请在抽屉界面开启 Shizuku 服务')
  exit()
}

let packages = [
  { pkg: 'com.eg.android.AlipayGphone', name: '支付宝' },
  { pkg: 'com.taobao.taobao', name: '淘宝' },
  { pkg: 'com.sankuai.meituan', name: '美团' },
  { pkg: 'com.taobao.idlefish', name: '闲鱼' },
  { pkg: 'com.taobao.etao', name: '一淘' },
  { pkg: 'com.taobao.trip', name: '飞猪' },
  { pkg: 'com.autonavi.minimap', name: '高德地图' }
]

LogFloaty.show()

// 检查进程状态
LogFloaty.pushLog('===== 检查进程运行状态 =====')
packages.forEach(p => {
  LogFloaty.pushLog(p.name + ': ' + (killProcessUtil.isRunning(p.pkg) ? '运行中' : '已停止'))
})

// 杀进程
LogFloaty.pushLog('')
LogFloaty.pushLog('===== 开始 kill 进程 =====')
killProcessUtil.killMultiple(packages, function(name, success) {
  LogFloaty.pushLog(name + ' → ' + (success ? '✓ 已杀掉' : '✗ 失败'))
})
