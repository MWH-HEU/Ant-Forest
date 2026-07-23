/*
 * @Description: 测试小工具 - 悬浮窗工具
 * 三个按钮：测试控件、关闭弹窗、退出脚本
 * 测试控件：调用 lib/WidgetInspector.js 的 3 种检测方法
 * 关闭弹窗：使用森林集市中的checkDialogAndClose函数
 * 日志文件：button.log
 */
let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let args = config.parseExecArgv()
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let LogFloaty = sRequire('LogFloaty')
let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
let killProcessUtil = require('../lib/KillProcessUtil.js')
let FileUtils = sRequire('FileUtils')
let WidgetInspector = require('../lib/WidgetInspector.js')(runtime, global)

runningQueueDispatcher.addRunningTask()

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}
config.show_debug_log = true
commonFunction.autoSetUpBangOffset(true)

// ============ 文件日志 (button.log) ============
let _logFile = null
let _logFilePath = FileUtils.getRealMainScriptPath(true) + '/logs/button.log'
function writeLog (msg) {
  try {
    if (!_logFile) {
      _logFile = open(_logFilePath, 'w')
    }
    if (_logFile) {
      let now = new Date()
      _logFile.writeline('[' + now.toLocaleString() + '] ' + msg)
      _logFile.flush()
    }
  } catch (e) {}
}

function taskLog(msg) {
  LogFloaty.pushLog(msg)
  writeLog(msg)
  debugInfo(msg)
}

// ============ 工具函数 ============

function killApps () {
  try {
    killProcessUtil.killMultiple([
      { pkg: config.package_name || 'com.eg.android.AlipayGphone', name: '支付宝' }
    ], function(name, success) {
      taskLog(name + ' → ' + (success ? '✓ 已杀掉' : '✗ 失败'))
    })
  } catch (e) {
    taskLog('kill进程异常: ' + e)
  }
}

// ============ 关闭弹窗（来自森林集市checkDialogAndClose） ============

function checkDialogAndClose () {
  // 不写入日志文件
  LogFloaty.pushLog('检查是否存在关闭弹窗按钮')
  let targetCloseBtn = selector().filter(node => {
    if (!node || !node.bounds()) {
      return false
    }
    let bd = node.bounds()
    let rate = bd.width() / bd.height()
    let centerX = bd.centerX()
    let centerY = bd.centerY()
    return rate >= 0.9 && rate <= 1.1 && Math.abs(centerX - config.device_width / 2) < 10 && centerY > config.device_height / 2
  }).findOne(1000)
  if (targetCloseBtn) {
    LogFloaty.pushLog('找到关闭弹窗按钮')
    automator.clickCenter(targetCloseBtn)
    sleep(500)
  } else {
    LogFloaty.pushLog('未找到关闭弹窗按钮')
  }
}

// ============ 悬浮窗 ============

let FloatyButtonSimple = require('../lib/FloatyButtonSimple.js')

// 悬浮窗移到屏幕右侧边缘外
function moveFloatyToEdge () {
  ui.post(() => {
    floatyBtnInstance.window.setPosition(config.device_width - 10, config.device_height * 0.65)
  })
}

// 悬浮窗移回屏幕中间
function moveFloatyToCenter () {
  ui.post(() => {
    floatyBtnInstance.window.setPosition(config.device_width / 2 - ~~(floatyBtnInstance.window.getWidth() / 2), config.device_height * 0.65)
  })
}

let btns = [
  {
    id: 'testControl',
    text: '测试控件',
    onClick: function () {
      taskLog('====== 测试控件 开始 ======')
      taskLog('设备分辨率: ' + config.device_width + 'x' + config.device_height)
      taskLog('日志文件: ' + _logFilePath)
      
      // 使用公共函数库 WidgetInspector 的 3 种检测方法
      let opts = { onLog: taskLog }
      WidgetInspector.detectByWidget(opts)
      WidgetInspector.detectAllNodes(opts)
      WidgetInspector.detectByOcr(opts)
      
      taskLog('====== 测试控件 结束 ======')
      LogFloaty.pushLog('测试控件执行完毕，详情请查看日志文件')
      
      // 执行完毕后把悬浮窗移到边缘
      moveFloatyToEdge()
    }
  },
  {
    id: 'closeDialog',
    text: '关闭弹窗',
    onClick: function () {
      checkDialogAndClose()
      moveFloatyToEdge()
    }
  }
]

let floatyBtnInstance = new FloatyButtonSimple('test-tool', btns, (btns) => {
  return `<horizontal>
    <vertical padding="1">
   ${btns.map(btn => {
    return `<vertical padding="1" id="${btn.id}_container"><button id="${btn.id}" text="${btn.text}" textSize="${btn.textSize ? btn.textSize : 12}sp" w="*" h="30" marginTop="5" marginBottom="5" /></vertical>`
  }).join('\n')
    }</vertical>
  </horizontal>`
}, function () {
  exitAndClean()
})

// 音量上键退出
threads.start(function () {
  events.observeKey()
  events.on("key_down", function (keyCode, event) {
    if (keyCode === 24) {
      exitAndClean()
    }
  })
})

function exitAndClean () {
  if (_logFile) {
    try {
      _logFile.close()
    } catch (e) {}
  }
  killApps()
  runningQueueDispatcher.removeRunningTask()
  exit()
}

commonFunction.registerOnEngineRemoved(function () {
  killApps()
  runningQueueDispatcher.removeRunningTask()
  if (_logFile) {
    try {
      _logFile.close()
    } catch (e) {}
  }
})
