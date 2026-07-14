importClass(java.util.concurrent.LinkedBlockingQueue)
importClass(java.util.concurrent.ThreadPoolExecutor)
importClass(java.util.concurrent.TimeUnit)
importClass(java.util.concurrent.CountDownLatch)
importClass(java.util.concurrent.ThreadFactory)
importClass(java.util.concurrent.Executors)

// 防重复运行由 runningQueueDispatcher 统一管理
// let currentEngine = engines.myEngine()
// let runningEngines = engines.all()
// let runningSize = runningEngines.length
// let currentSource = currentEngine.getSource() + ''
// if (runningSize > 1) {
//   runningEngines.forEach(compareEngine => {
//     let compareSource = compareEngine.getSource() + ''
//     if (currentEngine.id !== compareEngine.id && compareSource === currentSource) {
//       // 强制关闭同名的脚本
//       compareEngine.forceStop()
//     }
//   })
// }

let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let args = config.parseExecArgv()
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let resourceMonitor = require('../lib/ResourceMonitor.js')(runtime, global)
let FloatyInstance = sRequire('FloatyUtil')
let NotificationHelper = sRequire('Notification')
let LogFloaty = sRequire('LogFloaty')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let SimpleFloatyButton = require('../lib/FloatyButtonSimple.js')

let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
runningQueueDispatcher.addRunningTask()

// 文件日志（调试时取消注释即可）
// let _logFile = null
// let _logFilePath = FileUtils.getRealMainScriptPath(true) + '/logs/senlin.log'
// function writeLog (msg) {
//   try {
//     if (!_logFile) {
//       _logFile = open(_logFilePath, 'w')
//     }
//     if (_logFile) {
//       let now = new Date()
//       _logFile.writeline('[' + now.toLocaleString() + '] ' + msg)
//       _logFile.flush()
//     }
//   } catch (e) {}
// }
// 
// // 重写LogFloaty的pushLog方法，同时写入文件日志
// let _origPushLog = LogFloaty.pushLog
// LogFloaty.pushLog = function (msg) {
//   writeLog(msg)
//   _origPushLog.call(LogFloaty, msg)
// }
// let _origPushErrorLog = LogFloaty.pushErrorLog
// LogFloaty.pushErrorLog = function (msg) {
//   writeLog('[ERROR] ' + msg)
//   _origPushErrorLog.call(LogFloaty, msg)
// }
// let _origPushWarningLog = LogFloaty.pushWarningLog
// LogFloaty.pushWarningLog = function (msg) {
//   writeLog('[WARN] ' + msg)
//   _origPushWarningLog.call(LogFloaty, msg)
// }
if (!FloatyInstance.init()) {
  toastLog('初始化悬浮窗失败')
  exit()
}
FloatyInstance.enableLog()
if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}
config.show_debug_log = true
commonFunction.autoSetUpBangOffset(true)

let CONTEXT = {
  drawExecuteCount: 0,
  drawEnd: false
}

let executeArguments = config.parseExecArgv()
let executeByTimeTask = args.executeByTimeTask
if (executeByTimeTask) {
  // 注册自动移除运行中任务
  commonFunction.registerOnEngineRemoved(function () {
    config.resetBrightness && config.resetBrightness()
    runningQueueDispatcher.removeRunningTask(true, true,
      () => {
        config.isRunning = false
      }
    )
  }, 'main')
}

// 音量上键退出脚本（在独立线程中轮询检测）
infoLog('运行中可按音量上键关闭', true)
threads.start(function () {
  events.observeKey()
  events.on('key_down', function (keyCode, event) {
    if (keyCode === 24) {
      toastLog('用户按音量上键，退出脚本')
      exit()
    }
  })
})

let clickButtons = new SimpleFloatyButton('clickBalls', [
  {
    id: 'openForestHunt',
    text: '打开森林寻宝',
    hide: executeByTimeTask,
    onClick: function () {
      openForestHuntPage()
    }
  },
  {
    id: 'autoTask',
    text: '自动执行任务',
    onClick: function () {
      clickButtons.changeButtonStyle('autoTask', null, '#FF753A')
      executeAllTabs()
      clickButtons.changeButtonStyle('autoTask', null, '#3FBE7B')
      clickButtons.changeButtonText('autoTask', '自动执行任务')
    }
  },
  {
    id: 'hangout',
    text: '开始森林寻宝',
    hide: executeByTimeTask,
    onClick: function () {
      toastLog('请手动进入逛一逛界面，自动上下滑动15秒')
      clickButtons.changeButtonStyle('hangout', null, '#FF753A')
      let limit = 16
      while (limit-- > 0) {
        let start = new Date().getTime()
        LogFloaty.replaceLastLog('逛一逛 等待倒计时结束 剩余：' + limit + 's')
        clickButtons.changeButtonText('hangout', '等待' + limit + 's')
        if (limit % 2 == 0) {
          automator.randomScrollDown()
        } else {
          automator.randomScrollUp()
        }
        sleepIfNeeded(1000 - (new Date().getTime() - start))
      }
      clickButtons.changeButtonStyle('hangout', null, '#3FBE7B')
      clickButtons.changeButtonText('hangout', '开始逛一逛')
    }
  },
  {
    id: 'draw',
    text: '开始抽奖',
    hide: executeByTimeTask,
    onClick: function () {
      CONTEXT.drawExecuteCount = 0
      CONTEXT.drawEnd = false
      doDraw()
    }
  }
])
let clickButtonWindow = clickButtons.window
// 将悬浮窗移到屏幕上方
clickButtonWindow.setPosition(config.device_width * 0.1, config.device_height * 0.1)

// 保持运行
setInterval(function () { }, 1000)


if (executeByTimeTask) {
  // 自动模式：先打开森林寻宝页面，然后自动执行全部任务
  LogFloaty.pushLog('自动模式：正在打开森林寻宝')
  openForestHuntPage()
  // 将悬浮窗移到屏幕边缘，防止影响操作
  clickButtonWindow.setPosition(0, config.device_height * 0.1)
  clickButtons.data.clickExecuting = true
  clickButtons.changeButtonStyle('autoTask', null, '#FF753A')
  executeAllTabs()
  clickButtons.changeButtonStyle('autoTask', null, '#3FBE7B')
  clickButtons.changeButtonText('autoTask', '自动执行任务')
  // 返回蚂蚁森林收集页面
  LogFloaty.pushLog('任务完成，返回蚂蚁森林收集页面')
  commonFunction.minimize()
  sleep(500)
  exit()
} else {
  commonFunction.registerOnEngineRemoved(function () {
    runningQueueDispatcher.removeRunningTask()
  })
}


function sleepIfNeeded (time) {
  if (time > 0) {
    sleep(time)
  }
}

/* ===== 互助码相关功能（已注释，需要时取消注释即可） =====
const BASE_URL = 'https://tonyjiang.hatimi.top/mutual-help'
const DEVICE_ID = device.getAndroidId()
const CATEGORY = 'forestTreasureHunt'
const CATEGORY2 = 'forestTreasureHunt2'

function checkMutualCodeStatus () {
  LogFloaty.pushLog('正在检查当前互助码状态，请稍等')
  http.get(BASE_URL + '/mine?category=' + CATEGORY + '&deviceId=' + DEVICE_ID, {}, (response, err) => {
    if (err) {
      console.error('请求异常', err)
      checkMutualCodeStatusEvent()
      return
    }
    if (response) {
      let responseStr = response.body.string()
      console.log('获取响应：', responseStr)
      try {
        let data = JSON.parse(responseStr)
        if (data.record) {
          let record = data.record
          CONTEXT.recordText = record.text
          console.log('互助码：' + record.text)
          LogFloaty.pushLog('当前互助码更新时间：' + record.updatedAt)
          LogFloaty.pushLog('今天被获取次数：' + record.dailyCount)
          LogFloaty.pushLog('被报告无效次数：' + record.invalidCount)
        } else if (data.error) {
          LogFloaty.pushLog(data.error)
        }
      } catch (e) {
        console.error('执行异常' + e)
      }
    }
    checkMutualCodeStatusEvent()
  })
}

function checkMutualCodeStatusEvent () {
  LogFloaty.pushLog('正在检查当前活动互助码状态，请稍等')
  http.get(BASE_URL + '/mine?category=' + CATEGORY2 + '&deviceId=' + DEVICE_ID, {}, (response, err) => {
    if (err) {
      console.error('请求异常', err)
      return
    }
    if (response) {
      let responseStr = response.body.string()
      console.log('获取响应：', responseStr)
      try {
        let data = JSON.parse(responseStr)
        if (data.record) {
          let record = data.record
          CONTEXT.recordText = record.text
          console.log('互助码：' + record.text)
          LogFloaty.pushLog('当前活动互助码更新时间：' + record.updatedAt)
          LogFloaty.pushLog('今天被获取次数：' + record.dailyCount)
          LogFloaty.pushLog('被报告无效次数：' + record.invalidCount)
        } else if (data.error) {
          LogFloaty.pushLog(data.error)
        }
      } catch (e) {
        console.error('执行异常' + e)
      }
    }
  })
}

function markTextInvalid (text) {
  http.postJson(BASE_URL + '/invalid', {
    category: CATEGORY,
    deviceId: DEVICE_ID,
    text: text,
  }, null, (resp, err) => {
    if (err) {
      errorInfo('标记互助码无效失败', err)
      return
    }
    try {
      let result = JSON.parse(resp.body.string())
      if (result.error) {
        errorInfo('标记互助码无效失败' + result.error)
        return
      }
      debugInfo('标记互助码无效成功:' + result.message)
    } catch (e) {
      errorInfo('标记互助码无效失败', e)
    }
  })
}

function markUsed (text) {
  http.postJson(BASE_URL + '/used', {
    category: CATEGORY,
    deviceId: DEVICE_ID,
    text: text,
  }, null, (resp, err) => {
    if (err) {
      errorInfo('标记互助码已使用失败', err)
      return
    }
    debugInfo('标记互助码已使用成功' + resp.body.string())
  })
}

function getCodeAndOpen (category) {
  clickButtons.changeButtonStyle('getMutualCode', null, '#FF753A')
  clickButtons.changeButtonText('getMutualCode', '请求中...')
  toastLog('请求服务接口获取中，请稍后')
  let disposable = threads.disposable()
  http.get(BASE_URL + '/random?category=' + category + '&deviceId=' + DEVICE_ID, {}, (res, err) => {
    if (err) {
      console.error('请求异常', err)
      disposable.setAndNotify({ success: false, error: '请求异常' })
      return
    }
    if (res.body) {
      let responseStr = res.body.string()
      console.log('获取响应：', responseStr)
      try {
        let data = JSON.parse(responseStr)
        if (data.record) {
          console.log('互助码：' + data.record.text)
          disposable.setAndNotify({ success: true, text: data.record.text })
        } else if (data.error) {
          toastLog(data.error)
          disposable.setAndNotify({ success: false, error: data.error })
        }
      } catch (e) {
        console.error('执行异常' + e)
        disposable.setAndNotify({ success: false, error: '执行异常，具体见日志' })
      }
    }
  })

  let result = disposable.blockedGet()
  if (result.success) {
    setClip(result.text)
    app.startActivity({
      action: 'VIEW',
      data: 'alipays://platformapi/startapp?appId=20001003&keyword=' + encodeURI(result.text) + '&v2=true',
      packageName: 'com.eg.android.AlipayGphone'
    })
    let isValid = widgetUtils.widgetWaiting('去看看')
    if (!isValid) {
      if (widgetUtils.widgetWaiting('吱口令已失效', 1000)) {
        LogFloaty.pushLog('互助码已失效')
        markTextInvalid(result.text)
      }
      LogFloaty.pushLog('准备获取下一个互助码')
      return getCodeAndOpen(category)
    }
    // 等待界面加载完毕
    sleep(1000)
    let entry = widgetUtils.widgetGetOne('去看看', 1000)
    if (entry) {
      automator.clickCenter(entry)
      sleep(1000)
      widgetUtils.widgetWaiting('帮ta助力')
      sleep(1000)
      let target = widgetUtils.widgetGetOne('帮ta助力')
      if (target) {
        automator.clickCenter(target)
        sleep(1000)
        if (widgetUtils.widgetWaiting('^助力成功$', 2000)) {
          LogFloaty.pushLog('准备获取下一个互助码')
          markUsed(result.text)
          return getCodeAndOpen(category)
        } else {
          LogFloaty.pushLog('未能找到 助力成功 可能已经到达上限')
        }
      } else {
        LogFloaty.pushLog('未能找到 帮ta助力 可能已经到达上限')
      }
    }
  } else {
    toastLog('获取互助码失败' + result.error)
  }
  clickButtons.changeButtonText('getMutualCode', '获取互助码并打开')
  clickButtons.changeButtonStyle('getMutualCode', null, '#3FBE7B')
}
// ===== 互助码相关功能结束 ===== */

// 打开蚂蚁森林领奖励页面，然后点击森林寻宝区域的"去抽奖"进入森林寻宝
function openForestHuntPage () {
  LogFloaty.pushLog('正在打开蚂蚁森林')
  commonFunction.backHomeIfInVideoPackage()
  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=60000002',
    packageName: config.package_name
  })
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 2000)
  if (confirm) {
    automator.clickCenter(confirm)
  }
  sleep(1000)
  widgetUtils.widgetWaiting('.*(蚂蚁森林|森林|收集能量|浇水|去保护|找能量|森林广场).*', 3000)
  sleep(3000)
  LogFloaty.pushLog('蚂蚁森林已打开')
  
  // 点击"领奖励"进入领奖励弹窗
  LogFloaty.pushLog('查找领奖励入口')
  if (!clickClaimRewardByOcr()) {
    LogFloaty.pushLog('OCR未找到领奖励，尝试控件方式')
    clickClaimRewardByWidget()
  }
  sleep(3000)
  
  // 在领奖励弹窗中找"去抽奖"，点击进入森林寻宝
  // 这里要点击的是弹窗上半部分森林寻宝区域的"去抽奖"（y < 0.35*高度）
  // 与每日任务中排除的逻辑相反
  LogFloaty.pushLog('查找森林寻宝区域的"去抽奖"')
  
  // 先通过控件查找
  let found = false
  try {
    let allNodes = className('android.widget.Button').find()
    if (allNodes) {
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let t = node.text()
          if (t && t.toString().indexOf('去抽奖') >= 0) {
            let bounds = node.bounds()
            // 只点击上半部分的"去抽奖"（森林寻宝区域）
            if (bounds.centerY() < config.device_height * 0.35) {
              LogFloaty.pushLog('找到森林寻宝"去抽奖"，点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
              automator.click(bounds.centerX(), bounds.centerY())
              sleep(3000)
              found = true
              break
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    LogFloaty.pushLog('控件查找"去抽奖"异常: ' + e)
  }
  
  // OCR兜底
  if (!found && localOcrUtil.enabled) {
    LogFloaty.pushLog('控件未找到，尝试OCR识别"去抽奖"')
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let region = [0, 0, config.device_width, parseInt(config.device_height * 0.35)]
      let results = localOcrUtil.recognizeWithBounds(screen, region, '去抽奖')
      screen.recycle()
      if (results && results.length > 0) {
        let match = results[0]
        LogFloaty.pushLog('OCR找到"去抽奖": 点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
        automator.click(match.bounds.centerX(), match.bounds.centerY())
        sleep(3000)
        found = true
      }
    }
  }
  
  if (!found) {
    LogFloaty.pushLog('未找到森林寻宝"去抽奖"入口')
  } else {
    LogFloaty.pushLog('已进入森林寻宝页面')
    // 检测双Tab
    let eventTabs = checkHasEvent()
    if (eventTabs && eventTabs.length > 1) {
      LogFloaty.pushLog('检测到双Tab，共 ' + eventTabs.length + ' 个')
      // 先切换到Tab 0
      eventTabs[0].click()
      LogFloaty.pushLog('切换到Tab 0（默认界面）')
      sleep(1000)
    }
    // 进入页面后向下滚动一次，让任务列表区域显示出来
    LogFloaty.pushLog('滚动到任务列表区域')
    automator.scrollDown()
    sleep(500)
  }
}

// 等待后返回森林寻宝页面（kill支付宝进程重新打开）
function reopenForestHuntPage () {
  LogFloaty.pushLog('返回桌面并重新打开森林寻宝')
  
  // 返回桌面
  commonFunction.minimize()
  sleep(1000)
  
  // kill支付宝进程
  try {
    let packageName = config.package_name || 'com.eg.android.AlipayGphone'
    LogFloaty.pushLog('kill支付宝进程: ' + packageName)
    shell('am force-stop ' + packageName, true)
    sleep(2000)
  } catch (e) {
    LogFloaty.pushLog('kill支付宝进程失败: ' + e)
  }
  
  // 重新打开森林寻宝
  openForestHuntPage()
}

// 通过OCR识别"领奖励"入口并点击
function clickClaimRewardByOcr () {
  if (!localOcrUtil.enabled) {
    return clickClaimRewardByWidget()
  }
  
  commonFunction.requestScreenCaptureOrRestart()
  sleep(500)
  let screen = commonFunction.captureScreen()
  if (!screen) {
    LogFloaty.pushLog('截图失败')
    return false
  }
  
  let region = [0, parseInt(config.device_height * 0.5), config.device_width, parseInt(config.device_height * 0.4)]
  let results = localOcrUtil.recognizeWithBounds(screen, region, '领奖励')
  screen.recycle()
  
  if (results && results.length > 0) {
    let match = results[0]
    let bounds = match.bounds
    let clickX = bounds.centerX()
    let clickY = bounds.top - 60
    LogFloaty.pushLog('OCR找到领奖励: "' + match.label + '" 点击: (' + clickX + ', ' + clickY + ')')
    automator.click(clickX, clickY)
    sleep(2000)
    return true
  }
  
  return false
}

// 通过控件查找领奖励入口
function clickClaimRewardByWidget () {
  LogFloaty.pushLog('遍历控件查找领奖励入口')
  try {
    let allTextViews = className('android.widget.TextView').find()
    if (allTextViews) {
      for (let i = 0; i < allTextViews.size(); i++) {
        let tv = allTextViews.get(i)
        try {
          let t = tv.text()
          if (t && t.toString().indexOf('领奖励') >= 0) {
            let bounds = tv.bounds()
            let clickX = bounds.centerX()
            let clickY = bounds.top - 60
            LogFloaty.pushLog('找到领奖励文字控件，点击: (' + clickX + ', ' + clickY + ')')
            automator.click(clickX, clickY)
            sleep(2000)
            return true
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    LogFloaty.pushLog('遍历控件异常: ' + e)
  }
  
  // 通过"背包"推算
  LogFloaty.pushLog('尝试通过背包推算领奖励位置')
  let neighbor = widgetUtils.widgetGetOne('背包', 2000)
  if (neighbor) {
    let bounds = neighbor.bounds()
    let iconWidth = bounds.right - bounds.left
    let rewardX = bounds.left + iconWidth + 10
    let rewardY = bounds.centerY()
    LogFloaty.pushLog('通过背包推算领奖励: (' + rewardX + ', ' + rewardY + ')')
    automator.click(rewardX, rewardY)
    sleep(2000)
    return true
  }
  
  // 通过"乐园"推算
  neighbor = widgetUtils.widgetGetOne('乐园', 2000)
  if (neighbor) {
    let bounds = neighbor.bounds()
    let iconWidth = bounds.right - bounds.left
    let rewardX = bounds.left + iconWidth * 2 + 20
    let rewardY = bounds.centerY()
    LogFloaty.pushLog('通过乐园推算领奖励: (' + rewardX + ', ' + rewardY + ')')
    automator.click(rewardX, rewardY)
    sleep(2000)
    return true
  }
  
  return false
}

// 处理弹窗：检测"支付宝想要打开xxx"等并点击"打开"
function handlePopupDialog () {
  LogFloaty.pushLog('检查是否有弹窗')
  
  // 等待弹窗动画完成
  sleep(500)
  
  // 查找"打开"按钮（系统弹窗）
  let openBtn = widgetUtils.widgetGetOne(/^打开$/, 2000)
  if (openBtn) {
    LogFloaty.pushLog('检测到系统弹窗，点击"打开"')
    automator.clickCenter(openBtn)
    sleep(1500)
    return true
  }
  
  // 通过文字"支付宝"+"打开"判断
  try {
    let allTextViews = className('android.widget.TextView').find()
    if (allTextViews) {
      let hasAlipayText = false
      let hasOpenButton = false
      let openButton = null
      
      for (let i = 0; i < allTextViews.size(); i++) {
        let tv = allTextViews.get(i)
        try {
          let t = tv.text()
          if (t) {
            let text = t.toString()
            if (text.indexOf('支付宝') >= 0 && text.indexOf('打开') >= 0) {
              hasAlipayText = true
            }
            if (text === '打开') {
              hasOpenButton = true
              openButton = tv
            }
          }
        } catch (e) {}
      }
      
      if (hasAlipayText && hasOpenButton && openButton) {
        LogFloaty.pushLog('检测到"支付宝想要打开xxx"弹窗，点击"打开"')
        automator.clickCenter(openButton)
        sleep(1500)
        return true
      }
    }
  } catch (e) {
    LogFloaty.pushLog('检查弹窗异常: ' + e)
  }
  
  LogFloaty.pushLog('未检测到弹窗')
  return false
}

// 获取控件文本（安全）
function getNodeText (node) {
  try {
    let t = node.text()
    return t ? t.toString() : ''
  } catch (e) {
    return ''
  }
}

// 检查同一行内是否有倒计时文字（如"30s"、"浏览15s"等）
function hasCountdownInRow (rowNode) {
  try {
    let allDescendants = rowNode.find()
    if (allDescendants) {
      for (let i = 0; i < allDescendants.size(); i++) {
        let text = getNodeText(allDescendants.get(i))
        if (/\d+s/.test(text)) {
          LogFloaty.pushLog('检测到倒计时: ' + text)
          return true
        }
      }
    }
  } catch (e) {}
  return false
}

// 检查同一行内是否包含指定文字
function rowContainsText (rowNode, keyword) {
  try {
    let allDescendants = rowNode.find()
    if (allDescendants) {
      for (let i = 0; i < allDescendants.size(); i++) {
        let text = getNodeText(allDescendants.get(i))
        if (text.indexOf(keyword) >= 0) {
          return true
        }
      }
    }
  } catch (e) {}
  return false
}

// 在每个分支的任务执行后尝试领取奖励
function tryClaim () {
  let claimTarget = widgetUtils.widgetGetOne('领取', 500)
  if (claimTarget) {
    LogFloaty.pushLog('执行领取奖励')
    claimTarget.click()
    sleep(800)
  }
}

function doAutoCollect () {
  LogFloaty.pushLog('准备自动执行森林集市逛一逛')
  
  // 最多2轮
  let maxRounds = 3
  for (let round = 0; round < maxRounds; round++) {
    LogFloaty.pushLog('=== 森林寻宝 第 ' + (round + 1) + ' 轮 ===')
    
    // 每轮依次执行5个分支
    // 每个分支最多执行5次：每次找到则执行（执行后尝试领取），找不到则进入下一个分支
    // 如果连续5次都找到并执行了，也进入下一个分支
    
    // 分支1：签到（最多5次）
    for (let signTry = 0; signTry < 5; signTry++) {
      let signTarget = widgetUtils.widgetGetOne('签到', 1000)
      if (signTarget) {
        LogFloaty.pushLog('执行签到')
        signTarget.click()
        sleep(1000)
        tryClaim()
      } else {
        break  // 找不到就进入下一个分支
      }
    }
    
    // 分支2："去逛逛"（最多5次）
    for (let goTry = 0; goTry < 5; goTry++) {
      let goTarget = widgetUtils.widgetGetOne('去逛逛', 1000)
      if (!goTarget) break
      
      // 检查是否与"去森林市集逛一逛"在同一行
      let forestMarketTarget = widgetUtils.widgetGetOne(/去森林市集逛一逛/, 500)
      let isForestMarket = false
      if (forestMarketTarget) {
        let goBounds = goTarget.bounds()
        let marketBounds = forestMarketTarget.bounds()
        isForestMarket = Math.abs(goBounds.centerY() - marketBounds.centerY()) < 200
      }
      
      if (isForestMarket) {
        // 2.1 森林市集逛一逛 - 滑动分支
        LogFloaty.pushLog('找到"去森林市集逛一逛"，执行逛一逛')
        goTarget.click()
        widgetUtils.widgetWaiting('滑动浏览得抽奖机会')
        sleep(1000)
        LogFloaty.pushLog('开始自动滑动浏览')
        for (let s = 8; s > 0; s--) {
          let start = new Date().getTime()
          LogFloaty.replaceLastLog('逛一逛 等待倒计时结束 剩余：' + s + 's')
          clickButtons.changeButtonText('hangout', '等待' + s + 's')
          if (s % 2 == 0) {
            automator.randomScrollDown()
          } else {
            automator.randomScrollUp()
          }
          // 每次滑动后检查弹窗
          let abandonTarget = widgetUtils.widgetGetOne('放弃奖励', 800)
          if (abandonTarget) {
            LogFloaty.pushLog('检测到弹窗，点击"放弃奖励"')
            abandonTarget.click()
            sleep(1000)
          } else if (localOcrUtil.enabled) {
            commonFunction.requestScreenCaptureOrRestart()
            sleep(300)
            let screen = commonFunction.captureScreen()
            if (screen) {
              let results = localOcrUtil.recognizeWithBounds(screen, null, '放弃奖励')
              screen.recycle()
              if (results && results.length > 0) {
                let match = results[0]
                LogFloaty.pushLog('OCR找到"放弃奖励"，点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
                automator.click(match.bounds.centerX(), match.bounds.centerY())
                sleep(1000)
              }
            }
          }
          sleepIfNeeded(1000 - (new Date().getTime() - start))
        }
        sleep(2000)
        // 滑动结束后再检查一次弹窗
        LogFloaty.pushLog('检查是否有弹窗需要关闭')
        let abandonTarget = widgetUtils.widgetGetOne('放弃奖励', 1000)
        if (abandonTarget) {
          LogFloaty.pushLog('检测到弹窗，点击"放弃奖励"')
          abandonTarget.click()
          sleep(1000)
        } else if (localOcrUtil.enabled) {
          commonFunction.requestScreenCaptureOrRestart()
          sleep(500)
          let screen = commonFunction.captureScreen()
          if (screen) {
            let results = localOcrUtil.recognizeWithBounds(screen, null, '放弃奖励')
            screen.recycle()
            if (results && results.length > 0) {
              let match = results[0]
              LogFloaty.pushLog('OCR找到"放弃奖励"，点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
              automator.click(match.bounds.centerX(), match.bounds.centerY())
              sleep(1000)
            }
          }
        }
        clickButtons.changeButtonText('hangout', '开始逛一逛')
        automator.back()
        widgetUtils.widgetWaiting('去森林市集逛一逛')
        tryClaim()
      } else {
        // 2.2 其他"去逛逛" - 等待35s分支
        LogFloaty.pushLog('找到其他"去逛逛"，点击后处理弹窗')
        automator.clickCenter(goTarget)
        sleep(2000)
        handlePopupDialog()
        LogFloaty.pushLog('等待5秒后返回森林寻宝')
        sleep(5000)
        reopenForestHuntPage()
        tryClaim()
      }
    }
    
    // 分支3："马上玩"且周围有倒计时（最多5次）
    for (let playTry = 0; playTry < 5; playTry++) {
      let foundTimedPlay = false
      try {
        let allNodes = className('android.widget.Button').find()
        if (allNodes) {
          for (let i = 0; i < allNodes.size(); i++) {
            let node = allNodes.get(i)
            let text = getNodeText(node)
            if (text === '马上玩') {
              let hasTimed = false
              let playBounds = node.bounds()
              try {
                let allTextViews = className('android.widget.TextView').find()
                if (allTextViews) {
                  for (let t = 0; t < allTextViews.size(); t++) {
                    let tvText = getNodeText(allTextViews.get(t))
                    // 匹配包含数字+s的文字（如"30s"、"浏览30s，可得1次机会"）
                    if (/\d+s/.test(tvText)) {
                      let tvBounds = allTextViews.get(t).bounds()
                      // 同一行（Y坐标差距<100）
                      if (Math.abs(tvBounds.centerY() - playBounds.centerY()) < 100) {
                        LogFloaty.pushLog('检测到倒计时: ' + tvText)
                        hasTimed = true
                        break
                      }
                    }
                  }
                }
              } catch (e) {}
              if (hasTimed) {
                LogFloaty.pushLog('找到带倒计时的"马上玩"，点击后处理弹窗')
                automator.clickCenter(node)
                sleep(2000)
                handlePopupDialog()
                LogFloaty.pushLog('等待35秒后返回森林寻宝')
                sleep(35000)
                reopenForestHuntPage()
                tryClaim()
                foundTimedPlay = true
                break
              } else {
                LogFloaty.pushLog('跳过无倒计时的"马上玩"（需手动完成）')
              }
            }
          }
        }
      } catch (e) {
        LogFloaty.pushLog('查找"马上玩"异常: ' + e)
      }
      if (!foundTimedPlay) break  // 找不到带倒计时的就进入下一个分支
    }
    
    // 分支4："去兑换"（最多5次）
    for (let exchangeTry = 0; exchangeTry < 5; exchangeTry++) {
      let exchangeTarget = widgetUtils.widgetGetOne('去兑换', 1000)
      if (!exchangeTarget) break
      
      LogFloaty.pushLog('找到"去兑换"')
      exchangeTarget.click()
      sleep(1000)
      // 处理兑换确认弹窗
      let confirm = widgetUtils.widgetGetOne('确认兑换', 2000)
      if (confirm) {
        LogFloaty.pushLog('点击"确认兑换"')
        confirm.click()
        sleep(1500)
      }
      // 点击后弹窗可能还在，再点一次关闭
      confirm = widgetUtils.widgetGetOne('确认兑换', 1000)
      if (confirm) {
        confirm.click()
        sleep(1000)
      }
      tryClaim()
    }
    
    // 分支5：领取奖励（最多10次）
    for (let claimTry = 0; claimTry < 10; claimTry++) {
      let claimTarget = widgetUtils.widgetGetOne('领取', 1000)
      if (!claimTarget) break
      
      LogFloaty.pushLog('点击"领取"')
      claimTarget.click()
      sleep(1000)
    }
    
    LogFloaty.pushLog('第 ' + (round + 1) + ' 轮执行完毕，所有分支均无任务')
  }
  
  LogFloaty.pushLog('森林集市逛一逛执行完毕')
}

// 使用OCR查找并点击弹窗中的文字，返回true表示找到并点击了
function clickPopupButtonByOcr (keyword, timeout) {
  if (!localOcrUtil.enabled) return false
  let deadline = new Date().getTime() + timeout
  while (new Date().getTime() < deadline) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(300)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let results = localOcrUtil.recognizeWithBounds(screen, null, keyword)
      screen.recycle()
      if (results && results.length > 0) {
        let match = results[0]
        LogFloaty.pushLog('OCR找到"' + keyword + '"，点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
        automator.click(match.bounds.centerX(), match.bounds.centerY())
        sleep(1000)
        return true
      }
    }
    sleep(500)
  }
  return false
}

function doDraw () {
  if (CONTEXT.drawExecuteCount > 20) {
    LogFloaty.pushErrorLog('抽奖次数过多，自动退出 可能界面存在干扰')
    return false
  } else if (CONTEXT.drawEnd) {
    LogFloaty.pushErrorLog('抽奖已经标记结束 可能界面存在干扰')
    return false
  }
  LogFloaty.pushLog('准备开始抽奖 (第' + CONTEXT.drawExecuteCount + '次)')
  CONTEXT.drawExecuteCount++
  
  // 先检查是否出现"明日再来"（抽奖机会已用完）
  let tomorrowTarget = widgetUtils.widgetGetOne('明日再来', 1000)
  if (tomorrowTarget) {
    LogFloaty.pushLog('检测到"明日再来"，抽奖机会已用完')
    CONTEXT.drawEnd = true
    return false
  }
  
  let target = widgetUtils.widgetGetOne('还有')
  if (target) {
    let chance = widgetUtils.subWidgetGetOne(target.parent(), '\\d+', 2000)
    if (chance) {
      let chanceText = chance.text()
      if (chanceText) {
        if (chanceText != '0') {
          LogFloaty.pushLog('剩余抽奖次数: ' + chanceText + '，点击抽奖')
          automator.clickCenter(chance)
          sleep(3000)
          // 点击后可能出现弹窗："继续抽"（还有机会）或"做任务继续抽"（没机会了）
          // 先用OCR找"继续抽"，再找"做任务继续抽"
          let foundContinue = clickPopupButtonByOcr('继续抽', 3000)
          if (foundContinue) {
            LogFloaty.pushLog('点击"继续抽"关闭弹窗')
            sleep(1500)
          } else {
            // 找"做任务继续抽"
            let foundTaskContinue = clickPopupButtonByOcr('做任务继续抽', 3000)
            if (foundTaskContinue) {
              LogFloaty.pushLog('点击"做任务继续抽"，抽奖机会已用完')
              sleep(1500)
              CONTEXT.drawEnd = true
            } else {
              // 再尝试控件方式查找"继续抽"
              let continueTarget = widgetUtils.widgetGetOne('继续抽', 2000)
              if (continueTarget) {
                LogFloaty.pushLog('点击"继续抽"关闭弹窗')
                continueTarget.click()
                sleep(1500)
              } else {
                // 控件查找"做任务继续抽"
                let taskContinueTarget = widgetUtils.widgetGetOne(/做任务继续抽/, 2000)
                if (taskContinueTarget) {
                  LogFloaty.pushLog('点击"做任务继续抽"，抽奖机会已用完')
                  taskContinueTarget.click()
                  sleep(1500)
                  CONTEXT.drawEnd = true
                } else {
                  // 找关闭按钮（叉号）
                  let closeBtn = selector().clickable().className('android.widget.TextView').filter(node => node.bounds().width() == node.bounds().height()).depth(16).findOne(1000)
                  if (closeBtn) {
                    LogFloaty.pushLog('点击关闭按钮')
                    closeBtn.click()
                    sleep(1000)
                  } else {
                    LogFloaty.pushErrorLog('未找到弹窗关闭按钮')
                  }
                }
              }
            }
          }
          // 弹窗关闭后，检查是否还有抽奖机会
          LogFloaty.pushLog('检查是否还有抽奖机会')
          sleep(1000)
          return doDraw()
        } else {
          LogFloaty.pushLog('剩余抽奖次数为0')
        }
      }
    }
  } else {
    LogFloaty.pushLog('未找到抽奖按钮')
  }
  // 没有抽奖机会了，返回false
  return false
}

// 执行当前Tab的完整流程（逛一逛 + 抽奖），返回是否有抽奖机会
function executeTab () {
  clickButtons.changeButtonText('autoTask', '执行逛一逛...')
  doAutoCollect()
  clickButtons.changeButtonText('autoTask', '抽奖中...')
  let hasChance = doDraw()
  return hasChance
}

// 执行所有Tab（双Tab已在openForestHuntPage中检测并切换到Tab0）
function executeAllTabs () {
  let hasChance = executeTab()
  if (!hasChance) {
    // Tab0没机会了，尝试切换到Tab1
    let eventTabs = checkHasEvent()
    if (eventTabs && eventTabs.length > 1) {
      eventTabs[1].click()
      LogFloaty.pushLog('切换到Tab 1（活动界面）')
      sleep(1000)
      // 切换Tab后滚动到任务区域
      LogFloaty.pushLog('滚动到任务列表区域')
      automator.scrollDown()
      sleep(500)
      hasChance = executeTab()
    }
  }
  return hasChance
}

function checkHasEvent () {
  let appContainer = widgetUtils.widgetGetById('app')
  if (appContainer) {
    let subContainer = appContainer.child(0)
    if (subContainer) {
      try {
        let eventTabContainer = subContainer.child(1).child(0)
        if (eventTabContainer && eventTabContainer.childCount() > 1) {
          LogFloaty.pushLog('检测到双Tab，Tab数量: ' + eventTabContainer.childCount())
          return [eventTabContainer.child(0), eventTabContainer.child(1)]
        }
      } catch (e) {
        console.error(e)
      }
    }
  }
  return false
}