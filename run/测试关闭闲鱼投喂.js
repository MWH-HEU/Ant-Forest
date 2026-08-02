/*
 * @Description: 测试关闭闲鱼投喂弹窗 - 悬浮窗工具
 * 点击按钮后查找"领取并投喂"文字，然后在其正下方找正方形关闭按钮并点击
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

function openLogFile () {
  try {
    if (_logFile) {
      _logFile.close()
    }
  } catch (e) {}
  _logFile = open(_logFilePath, 'w')
}

function writeLog (msg) {
  try {
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

// ============ 关闭闲鱼投喂弹窗 ============

function checkDialogAndClose () {
  taskLog('检查是否存在"领取并投喂"弹窗')
  try {
    let result = WidgetInspector.detectAllNodesVisible()
    let feedBtn = null
    let feedBounds = null

    for (let node of result.nodes) {
      if (node.text === '领取并投喂') {
        feedBtn = node
        feedBounds = node.bounds
        break
      }
    }

    if (!feedBtn) {
      taskLog('未找到"领取并投喂"弹窗')
      return false
    }

    taskLog('找到"领取并投喂"，bounds=(' +
      feedBounds.left + ',' + feedBounds.top + ',' +
      feedBounds.right + ',' + feedBounds.bottom +
      ') center=(' + feedBounds.centerX() + ',' + feedBounds.centerY() + ')')

    taskLog('查找其正下方关闭按钮')

    for (let node of result.nodes) {
      let bd = node.bounds
      if (!bd) continue
      if (node.text && node.text !== '') continue
      let rate = bd.width() / bd.height()
      if (rate < 0.99 || rate > 1.01) continue
      if (Math.abs(bd.centerX() - feedBounds.centerX()) > 50) continue
      if (bd.top < feedBounds.bottom + 50) continue
      if (bd.top > feedBounds.bottom + 400) continue
      taskLog('找到关闭按钮，bounds=(' +
        bd.left + ',' + bd.top + ',' +
        bd.right + ',' + bd.bottom +
        ') center=(' + bd.centerX() + ',' + bd.centerY() + ')' +
        ' rate=' + rate.toFixed(4))
      automator.click(bd.centerX(), bd.centerY())
      sleep(500)
      return true
    }

    taskLog('未找到关闭按钮')
    return false
  } catch (e) {
    taskLog('关闭弹窗异常: ' + e)
    return false
  }
}

// ============ 悬浮窗 ============

let FloatyButtonSimple = require('../lib/FloatyButtonSimple.js')

function moveFloatyToEdge () {
  ui.post(() => {
    floatyBtnInstance.window.setPosition(-90, config.device_height * 0.65)
  })
}

let btns = [
  {
    id: 'testControl',
    text: '测试控件',
    onClick: function () {
      moveFloatyToEdge()
      openLogFile()

      taskLog('====== 测试控件 开始 ======')
      taskLog('设备分辨率: ' + config.device_width + 'x' + config.device_height)
      taskLog('日志文件: ' + _logFilePath)

      let opts = { onLog: taskLog }
      WidgetInspector.detectByWidgetVisible(opts)
      WidgetInspector.detectAllNodesVisible(opts)
      WidgetInspector.detectByOcr(opts)

      taskLog('====== 测试控件 结束 ======')
    }
  },

  {
    id: 'closeDialog',
    text: '关闭闲鱼投喂',
    onClick: function () {
      moveFloatyToEdge()
      checkDialogAndClose()
    }
  }
]

let floatyBtnInstance = new FloatyButtonSimple('test-tool-close-fish-feed', btns, (btns) => {
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
  runningQueueDispatcher.removeRunningTask()
  exit()
}

commonFunction.registerOnEngineRemoved(function () {
  runningQueueDispatcher.removeRunningTask()
  if (_logFile) {
    try {
      _logFile.close()
    } catch (e) {}
  }
})
