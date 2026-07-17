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
let killProcessUtil = require('../lib/KillProcessUtil.js')

let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
runningQueueDispatcher.addRunningTask()

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

// ============================================================
// 核心逻辑：限时能量雨兑换
// ============================================================

// 等待弹窗稳定
function waitPopupStable (ms) {
  sleep(ms || 2000)
}

// 通过控件查找并点击指定文字
function clickWidgetByText (text, timeout) {
  let target = widgetUtils.widgetGetOne(text, timeout || 3000)
  if (target) {
    LogFloaty.pushLog('找到"' + text + '"，点击')
    automator.clickCenter(target)
    sleep(500)
    return true
  }
  return false
}

// 通过OCR识别并点击指定文字
function clickByOcr (keyword, timeout) {
  if (!localOcrUtil.enabled) return false
  let deadline = new Date().getTime() + (timeout || 3000)
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
        sleep(500)
        return true
      }
    }
    sleep(500)
  }
  return false
}

// 综合查找：先控件，后OCR
function clickByWidgetOrOcr (text, timeout) {
  if (clickWidgetByText(text, timeout)) return true
  return clickByOcr(text, timeout)
}

// 处理弹窗：类似森林寻宝中处理"立即兑换"分支的方式
// 先控件查找，找不到则用OCR
function handlePopupButton (buttonText, timeout) {
  LogFloaty.pushLog('查找弹窗按钮: "' + buttonText + '"')
  return clickByWidgetOrOcr(buttonText, timeout || 3000)
}

// 步骤1：打开蚂蚁森林，进入"背包"页面
function step1_openBackpack () {
  LogFloaty.pushLog('=== 步骤1：打开蚂蚁森林并进入背包 ===')
  
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
  
  // 直接查找"背包"按钮并点击进入背包页面（不经过领奖励）
  LogFloaty.pushLog('查找"背包"按钮')
  if (!clickByWidgetOrOcr('背包', 3000)) {
    LogFloaty.pushLog('直接查找背包失败，尝试其他方式')
    // 背包可能在屏幕底部，尝试通过坐标点击
    let backpackTarget = widgetUtils.widgetGetOne('背包', 2000)
    if (backpackTarget) {
      automator.clickCenter(backpackTarget)
      sleep(2000)
    } else {
      LogFloaty.pushErrorLog('未找到背包入口')
      return false
    }
  }
  
  waitPopupStable(2000)
  LogFloaty.pushLog('已进入背包页面')
  return true
}

// 步骤2：点击"用活力值兑换"
function step2_clickExchangeWithVitality () {
  LogFloaty.pushLog('=== 步骤2：点击"用活力值兑换" ===')
  waitPopupStable(2000)
  
  // 策略：找到"道具"或"伙伴"文字控件，计算其高度，然后点击往下2倍高度的位置
  // 因为"用活力值兑换"卡片在背包弹窗中位于道具列表的第一格
  // 而"道具"或"伙伴"是背包弹窗顶部的分类标签
  
  let targetY = -1
  let targetX = -1
  
  // 先找"道具"或"伙伴"分类标签
  try {
    let allTextViews = className('android.widget.TextView').find()
    if (allTextViews) {
      for (let i = 0; i < allTextViews.size(); i++) {
        let tv = allTextViews.get(i)
        try {
          let t = tv.text()
          if (t) {
            let text = t.toString()
            if (text.indexOf('道具') >= 0 || text.indexOf('伙伴') >= 0) {
              let bounds = tv.bounds()
              let itemHeight = bounds.bottom - bounds.top
              targetY = bounds.bottom + itemHeight * 2
              targetX = bounds.centerX()
              LogFloaty.pushLog('找到"' + text + '"，高度: ' + itemHeight + '，点击位置: (' + targetX + ', ' + targetY + ')')
              break
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    LogFloaty.pushLog('控件查找异常: ' + e)
  }
  
  // 如果控件没找到，尝试OCR找"道具"或"伙伴"
  if (targetY < 0 && localOcrUtil.enabled) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(300)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let region = [0, 0, config.device_width, parseInt(config.device_height * 0.4)]
      let results = localOcrUtil.recognizeWithBounds(screen, region, '道具|伙伴')
      if (results && results.length > 0) {
        let match = results[0]
        let bounds = match.bounds
        let itemHeight = bounds.bottom - bounds.top
        targetY = bounds.bottom + itemHeight * 2
        targetX = bounds.centerX()
        LogFloaty.pushLog('OCR找到"' + match.label + '"，高度: ' + itemHeight + '，点击位置: (' + targetX + ', ' + targetY + ')')
      }
      screen.recycle()
    }
  }
  
  if (targetY > 0) {
    LogFloaty.pushLog('点击坐标: (' + targetX + ', ' + targetY + ')')
    automator.click(targetX, targetY)
    sleep(500)
    waitPopupStable(2000)
    LogFloaty.pushLog('已进入活力值兑换页面')
    return true
  }
  
  LogFloaty.pushErrorLog('未找到"道具"或"伙伴"分类标签')
  return false
}

// 步骤3：点击"能量雨次卡"下的"兑换"
// 注意：每天限兑换一次，如果已兑换则显示"已达上限"
function step3_clickEnergyRainCardExchange () {
  LogFloaty.pushLog('=== 步骤3：点击能量雨次卡的"兑换" ===')
  waitPopupStable(2000)
  
  // 直接点击"能量雨次卡"卡片（控件或OCR），不找"兑换"按钮
  let found = false
  
  // 控件查找
  try {
    let allTextViews = className('android.widget.TextView').find()
    if (allTextViews) {
      for (let i = 0; i < allTextViews.size(); i++) {
        let tv = allTextViews.get(i)
        try {
          let t = tv.text()
          if (t && t.toString().indexOf('能量雨次卡') >= 0) {
            let bounds = tv.bounds()
            LogFloaty.pushLog('控件找到"能量雨次卡"，点击卡片中心: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
            automator.click(bounds.centerX(), bounds.centerY())
            sleep(500)
            found = true
            break
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    LogFloaty.pushLog('控件查找异常: ' + e)
  }
  
  // OCR兜底
  if (!found && localOcrUtil.enabled) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(300)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let results = localOcrUtil.recognizeWithBounds(screen, null, '能量雨次卡')
      if (results && results.length > 0) {
        let match = results[0]
        LogFloaty.pushLog('OCR找到"能量雨次卡"，点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
        automator.click(match.bounds.centerX(), match.bounds.centerY())
        sleep(500)
        found = true
      }
      screen.recycle()
    }
  }
  
  if (!found) {
    LogFloaty.pushErrorLog('未找到"能量雨次卡"卡片')
    return false
  }
  
  waitPopupStable(2000)
  
  // 点击后检查是否弹出"已达上限"（每天已兑换过）
  let alreadyExchanged = false
  try {
    let allTextViews = className('android.widget.TextView').find()
    if (allTextViews) {
      for (let i = 0; i < allTextViews.size(); i++) {
        let tv = allTextViews.get(i)
        try {
          let t = tv.text()
          if (t && t.toString().indexOf('已达上限') >= 0) {
            LogFloaty.pushLog('检测到"已达上限"，今天已兑换过')
            alreadyExchanged = true
            break
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    LogFloaty.pushLog('控件查找异常: ' + e)
  }
  
  // OCR兜底检查"已达上限"
  if (!alreadyExchanged && localOcrUtil.enabled) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(300)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let results = localOcrUtil.recognizeWithBounds(screen, null, '已达上限')
      if (results && results.length > 0) {
        LogFloaty.pushLog('OCR检测到"已达上限"，今天已兑换过')
        alreadyExchanged = true
      }
      screen.recycle()
    }
  }
  
  if (alreadyExchanged) {
    LogFloaty.pushLog('已达上限，返回特殊标记跳过步骤4')
    return 'already_exchanged'
  }
  
  LogFloaty.pushLog('已进入兑换确认页面')
  return true
}

// 步骤4：点击"立即兑换" -> "确认兑换" -> "立即使用"
function step4_confirmExchangeAndUse () {
  LogFloaty.pushLog('=== 步骤4：兑换并立即使用 ===')
  waitPopupStable(2000)
  
  // 4.1 点击"立即兑换"
  LogFloaty.pushLog('点击"立即兑换"')
  if (!handlePopupButton('立即兑换', 3000)) {
    LogFloaty.pushErrorLog('未找到"立即兑换"按钮')
    return false
  }
  waitPopupStable(2000)
  
  // 4.2 点击"确认兑换"
  LogFloaty.pushLog('点击"确认兑换"')
  if (!handlePopupButton('确认兑换', 3000)) {
    LogFloaty.pushErrorLog('未找到"确认兑换"按钮')
    return false
  }
  waitPopupStable(2000)
  
  // 4.3 点击"立即使用"（兑换成功后的弹窗）
  LogFloaty.pushLog('点击"立即使用"')
  if (!handlePopupButton('立即使用', 3000)) {
    LogFloaty.pushErrorLog('未找到"立即使用"按钮')
    return false
  }
  waitPopupStable(2000)
  
  LogFloaty.pushLog('兑换并使用成功，已返回背包页面')
  return true
}

// 步骤5：在背包中查找"能量雨机会"，点击"使用"
function step5_findAndUseEnergyRainCard () {
  LogFloaty.pushLog('=== 步骤5：查找能量雨机会并使用 ===')
  waitPopupStable(2000)
  
  // 查找"限时能量雨机会"或"能量雨机会"卡片
  // 策略：先控件查找，找不到则OCR识别，再找不到则滑动后重试
  
  let found = false
  let maxScrollAttempts = 8
  let scrollAttempt = 0
  
  while (!found && scrollAttempt < maxScrollAttempts) {
    if (scrollAttempt > 0) {
      LogFloaty.pushLog('第' + (scrollAttempt + 1) + '次滑动查找')
      // 向上滑动一段距离（背包列表是垂直滚动的）
      automator.randomScrollDown()
      sleep(1000)
    }
    
    // 先通过控件查找"限时能量雨机会"或"能量雨机会"
    try {
      let allTextViews = className('android.widget.TextView').find()
      if (allTextViews) {
        for (let i = 0; i < allTextViews.size(); i++) {
          let tv = allTextViews.get(i)
          try {
            let t = tv.text()
            if (t) {
              let text = t.toString()
              if (text.indexOf('能量雨机会') >= 0 || text.indexOf('能量雨次卡') >= 0) {
                let cardBounds = tv.bounds()
                LogFloaty.pushLog('控件找到"' + text + '"，位置: (' + cardBounds.centerX() + ', ' + cardBounds.centerY() + ')')
                
                // 在该卡片上找"使用"按钮
                let useBtn = widgetUtils.widgetGetOne('使用', 1000)
                if (useBtn) {
                  let btnBounds = useBtn.bounds()
                  // 验证是否在同一卡片区域
                  if (Math.abs(btnBounds.centerY() - cardBounds.centerY()) < 300) {
                    LogFloaty.pushLog('找到"使用"按钮，点击')
                    automator.clickCenter(useBtn)
                    sleep(500)
                    found = true
                    break
                  }
                }
              }
            }
          } catch (e) {}
        }
      }
    } catch (e) {
      LogFloaty.pushLog('控件查找异常: ' + e)
    }
    
    if (found) break
    
    // OCR识别
    if (localOcrUtil.enabled && !found) {
      commonFunction.requestScreenCaptureOrRestart()
      sleep(300)
      let screen = commonFunction.captureScreen()
      if (screen) {
        // 先找"能量雨机会"或"能量雨次卡"
        let cardResults = localOcrUtil.recognizeWithBounds(screen, null, '能量雨')
        if (cardResults && cardResults.length > 0) {
          let cardMatch = cardResults[0]
          LogFloaty.pushLog('OCR找到"' + cardMatch.label + '"')
          
          // 在卡片区域找"使用"
          let cardRegion = cardMatch.bounds
          let searchRegion = [
            cardRegion.left - 50,
            cardRegion.top - 50,
            cardRegion.right - cardRegion.left + 200,
            cardRegion.bottom - cardRegion.top + 150
          ]
          let useResults = localOcrUtil.recognizeWithBounds(screen, searchRegion, '使用')
          if (useResults && useResults.length > 0) {
            let match = useResults[0]
            LogFloaty.pushLog('OCR找到"使用"，点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
            automator.click(match.bounds.centerX(), match.bounds.centerY())
            sleep(500)
            found = true
          } else {
            // 直接点击卡片底部的"使用"按钮位置
            let clickX = cardMatch.bounds.centerX()
            let clickY = cardMatch.bounds.bottom - 30
            LogFloaty.pushLog('尝试点击卡片底部: (' + clickX + ', ' + clickY + ')')
            automator.click(clickX, clickY)
            sleep(500)
            // 检查是否点击到了"使用"
            if (widgetUtils.widgetGetOne('立即使用', 1000)) {
              found = true
            }
          }
        }
        screen.recycle()
      }
    }
    
    scrollAttempt++
  }
  
  if (!found) {
    LogFloaty.pushErrorLog('未找到"能量雨机会"卡片，可能已使用完或不存在')
    return false
  }
  
  waitPopupStable(2000)
  LogFloaty.pushLog('已点击"使用"，进入使用确认页面')
  return true
}

// 步骤6：点击"立即使用"
function step6_clickUseNow () {
  LogFloaty.pushLog('=== 步骤6：点击"立即使用" ===')
  waitPopupStable(2000)
  
  if (!handlePopupButton('立即使用', 3000)) {
    LogFloaty.pushErrorLog('未找到"立即使用"按钮')
    return false
  }
  
  waitPopupStable(2000)
  LogFloaty.pushLog('能量雨次卡已成功使用！')
  return true
}

// 主流程
function main () {
  LogFloaty.pushLog('========== 限时能量雨兑换 开始 ==========')
  
  // 步骤1：打开蚂蚁森林 -> 背包
  if (!step1_openBackpack()) {
    LogFloaty.pushErrorLog('步骤1失败：无法进入背包页面')
    return false
  }
  
  // 步骤2：点击"用活力值兑换"
  if (!step2_clickExchangeWithVitality()) {
    LogFloaty.pushErrorLog('步骤2失败：无法进入活力值兑换页面')
    return false
  }
  
  // 步骤3：点击"能量雨次卡"下的"兑换"
  let step3Result = step3_clickEnergyRainCardExchange()
  if (step3Result === 'already_exchanged') {
    // 今天已兑换过，跳过步骤4，直接重新打开背包执行步骤5
    LogFloaty.pushLog('今天已兑换过，跳过兑换步骤，直接去背包使用')
    if (!step1_openBackpack()) {
      LogFloaty.pushErrorLog('重新打开背包失败')
      return false
    }
  } else if (!step3Result) {
    LogFloaty.pushErrorLog('步骤3失败：无法点击能量雨次卡的兑换')
    return false
  } else {
    // 步骤4：立即兑换 -> 确认兑换 -> 立即使用
    if (!step4_confirmExchangeAndUse()) {
      LogFloaty.pushErrorLog('步骤4失败：兑换流程异常')
      return false
    }
  }
  
  // 步骤5：查找能量雨机会并点击"使用"
  if (!step5_findAndUseEnergyRainCard()) {
    LogFloaty.pushErrorLog('步骤5失败：未找到能量雨机会卡片')
    return false
  }
  
  // 步骤6：点击"立即使用"
  if (!step6_clickUseNow()) {
    LogFloaty.pushErrorLog('步骤6失败：无法点击立即使用')
    return false
  }
  
  LogFloaty.pushLog('========== 限时能量雨兑换 完成 ==========')
  return true
}

// 退出：返回桌面
function cleanUpAndExit () {
  LogFloaty.pushLog('任务完成，返回桌面')
  commonFunction.minimize()
  sleep(500)
  exit()
}

// ============================================================
// 执行入口
// ============================================================

if (executeByTimeTask) {
  // 自动模式
  LogFloaty.pushLog('自动模式：开始限时能量雨兑换')
  main()
  LogFloaty.pushLog('任务完成')
  cleanUpAndExit()
} else {
  // 手动模式：直接执行
  commonFunction.registerOnEngineRemoved(function () {
    runningQueueDispatcher.removeRunningTask()
  })
  main()
  LogFloaty.pushLog('任务完成')
  cleanUpAndExit()
}
