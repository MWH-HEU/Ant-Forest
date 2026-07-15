/*
 * 神奇海洋核心脚本
 * 功能：
 * 1. 打开神奇海洋 → 收集自己的垃圾
 * 2. 进入奖励页面 → 领取奖励（点击"立即领取"，处理"收下|返回"弹窗）
 * 3. 按分支完成任务：
 *    - "去清理"：收集好友垃圾
 *    - "去看看"：分"逛一逛市集"（滑动）和其他（等待35s/2s）
 *    - "去答题"：选择第一个选项
 *    - "去逛逛"：分有倒计时（等待20s）和无倒计时（等待2s）
 * 4. 排除项："去快手看蚂蚁森林"、"闯关"、"连续3天来海洋"
 */
let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let args = config.parseExecArgv()
let singletonRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let automator = singletonRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = singletonRequire('LogUtils')
let commonFunction = singletonRequire('CommonFunction')
let widgetUtils = singletonRequire('WidgetUtils')
let FloatyInstance = singletonRequire('FloatyUtil')
let LogFloaty = singletonRequire('LogFloaty')
let runningQueueDispatcher = singletonRequire('RunningQueueDispatcher')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let YoloDetectionUtil = singletonRequire('YoloDetectionUtil')
let YoloTrainHelper = singletonRequire('YoloTrainHelper')
let resourceMonitor = require('../lib/ResourceMonitor.js')(runtime, global)
let FileUtils = require('../lib/prototype/FileUtils.js')

runningQueueDispatcher.addRunningTask()

// 日志文件
let _logFile = null
let _logFilePath = FileUtils.getRealMainScriptPath(true) + '/logs/haiyang.log'
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

let SCALE_RATE = config.scaleRate
let cvt = (v) => parseInt(v * SCALE_RATE)
config.sea_ball_region = config.sea_ball_region || [cvt(860), cvt(1350), cvt(140), cvt(160)]

// 调试日志（悬浮窗显示 + 写入日志文件）
function taskLog (msg) {
  LogFloaty.pushLog(msg)
  writeLog(msg)
}

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}

// 注册自动移除运行中任务
commonFunction.registerOnEngineRemoved(function () {
  config.resetBrightness && config.resetBrightness()
  debugInfo('校验并移除已加载的dex')
  if (typeof destoryPool != 'undefined') {
    destoryPool()
  }
  runningQueueDispatcher.removeRunningTask(true, false, () => {
    config.isRunning = false
  })
}, 'main')

let shizukuSupport = true
if (!config.force_sea_auto_click) {
  if (typeof $shizuku == 'undefined') {
    errorInfo('当前版本不支持shizuku')
    shizukuSupport = false
  } else if (!$shizuku.isRunning()) {
    errorInfo('当前shizuku未运行 无法执行shizuku点击')
    shizukuSupport = false
  }
  if (!shizukuSupport) {
    errorInfo('请在神奇海洋设置中关闭3D模式，否则无法执行点击操作', true)
  }
} else {
  shizukuSupport = false
  warnInfo(['当前强制使用无障碍点击，不使用shizuku，请确保在神奇海洋设置中关闭3D模式，否则无法执行点击操作'])
}

// ============ 工具函数 ============

function clickPoint (x, y) {
  if (shizukuSupport) {
    x = parseInt(x)
    y = parseInt(y)
    debugInfo(['shizuku点击：{}, {}', x, y])
    $shizuku(`input tap ${x} ${y}`)
  } else {
    automator.click(x, y)
  }
}

function waitAndClick (text, timeout) {
  timeout = timeout || 3000
  let btn = widgetUtils.widgetGetOne(text, timeout)
  if (btn) {
    taskLog('点击: ' + text)
    automator.clickCenter(btn)
    sleep(1000)
    return true
  }
  return false
}

function goBack () {
  back()
  sleep(800)
}

function getNodeText (node) {
  try {
    let t = node.text()
    return t ? t.toString() : ''
  } catch (e) {
    return ''
  }
}

/**
 * 处理弹窗：检测"收下|回到我的海洋|返回"等
 */
function handlePopupDialog () {
  taskLog('检查是否有弹窗')
  sleep(500)

  // 查找"收下"按钮
  let btn = widgetUtils.widgetGetOne(/^收下$/, 2000)
  if (btn) {
    taskLog('检测到"收下"弹窗')
    automator.clickCenter(btn)
    sleep(1000)
    return true
  }

  // 查找"回到我的海洋"按钮
  btn = widgetUtils.widgetGetOne(/^回到我的海洋$/, 2000)
  if (btn) {
    taskLog('检测到"回到我的海洋"弹窗')
    automator.clickCenter(btn)
    sleep(1000)
    return true
  }

  // 查找"返回"按钮
  btn = widgetUtils.widgetGetOne(/^返回$/, 2000)
  if (btn) {
    taskLog('检测到"返回"弹窗')
    automator.clickCenter(btn)
    sleep(1000)
    return true
  }

  // 查找"打开"按钮（系统弹窗）
  let openBtn = widgetUtils.widgetGetOne(/^打开$/, 2000)
  if (openBtn) {
    taskLog('检测到系统弹窗，点击"打开"')
    automator.clickCenter(openBtn)
    sleep(1500)
    return true
  }

  taskLog('未检测到弹窗')
  return false
}

/**
 * 检查该行是否有排除项
 */
function hasExclusion (bounds, excludeTexts) {
  try {
    let allNodes = className('android.widget.Button').find()
    if (allNodes) {
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let nt = allNodes.get(i).text()
          if (nt) {
            let nText = nt.toString()
            for (let s = 0; s < excludeTexts.length; s++) {
              if (nText.indexOf(excludeTexts[s]) >= 0) {
                let nb = allNodes.get(i).bounds()
                if (Math.abs(nb.centerY() - bounds.centerY()) < 200) {
                  taskLog('排除"' + excludeTexts[s] + '"行的任务')
                  return true
                }
              }
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
  return false
}

/**
 * 检查同行是否有倒计时文本（如"30s"、"浏览30s"等）
 */
function hasCountdownInSameRow (bounds) {
  try {
    let allTextViews = className('android.widget.TextView').find()
    if (allTextViews) {
      for (let t = 0; t < allTextViews.size(); t++) {
        try {
          let tvText = getNodeText(allTextViews.get(t))
          if (/\d+s/.test(tvText)) {
            let tvBounds = allTextViews.get(t).bounds()
            if (Math.abs(tvBounds.centerY() - bounds.centerY()) < 100) {
              taskLog('同行检测到倒计时: ' + tvText)
              return true
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
  return false
}


/**
 * 检查同行是否含有指定文字
 */
function hasTextInSameRow (bounds, keyword) {
  try {
    let allTextViews = className('android.widget.TextView').find()
    if (allTextViews) {
      for (let t = 0; t < allTextViews.size(); t++) {
        try {
          let tvText = getNodeText(allTextViews.get(t))
          if (tvText.indexOf(keyword) >= 0) {
            let tvBounds = allTextViews.get(t).bounds()
            if (Math.abs(tvBounds.centerY() - bounds.centerY()) < 100) {
              taskLog('同行检测到文字: ' + keyword)
              return true
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {}
  return false
}

/**
 * 重新打开神奇海洋并进入奖励页面
 */
function reopenSeaAndRewardPage () {
  taskLog('返回桌面并重新打开神奇海洋')
  commonFunction.minimize()
  sleep(1000)

  // kill支付宝进程
  try {
    let packageName = config.package_name || 'com.eg.android.AlipayGphone'
    taskLog('kill支付宝进程: ' + packageName)
    shell('am force-stop ' + packageName, true)
    sleep(2000)
  } catch (e) {
    taskLog('kill支付宝进程失败: ' + e)
  }

  // 重新打开神奇海洋
  openMiracleOcean()

  // 进入奖励页面
  taskLog('重新进入奖励页面')
  enterRewardPage()
  sleep(3000)
}

// ============ 神奇海洋操作 ============

function openMiracleOcean () {
  logInfo('准备打开神奇海洋')
  commonFunction.backHomeIfInVideoPackage()
  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=2021003115672468',
    packageName: config.package_name
  })
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 1000)
  if (confirm) {
    automator.clickCenter(confirm)
  }
  sleep(1000)
  if (widgetUtils.idWaiting('user-energy-info', '神奇海洋')) {
    debugInfo(['打开神奇海洋成功'])
  } else {
    warnInfo(['打开神奇海洋检测超时'])
  }
  sleep(1000)
}

/**
 * 进入奖励页面
 * 通过OCR识别"奖励"文字并点击
 */
function enterRewardPage () {
  taskLog('查找"奖励"入口')

  if (!localOcrUtil.enabled) {
    taskLog('OCR未启用，跳过领奖励')
    return false
  }

  commonFunction.requestScreenCaptureOrRestart()
  sleep(500)
  let screen = commonFunction.captureScreen()
  if (!screen) {
    taskLog('截图失败，跳过领奖励')
    return false
  }

  // "奖励"在屏幕下半部分
  let region = [0, parseInt(config.device_height * 0.5), config.device_width, parseInt(config.device_height * 0.4)]
  let results = localOcrUtil.recognizeWithBounds(screen, region, '奖励')
  screen.recycle()

  if (results && results.length > 0) {
    let match = results[0]
    let bounds = match.bounds
    let clickX = bounds.centerX()
    let clickY = bounds.top - 60
    taskLog('OCR找到"奖励": "' + match.label + '" 点击: (' + clickX + ', ' + clickY + ')')
    automator.click(clickX, clickY)
    sleep(2000)
    return true
  } else {
    taskLog('OCR未识别到"奖励"文字')
    return false
  }
}

// ============ 垃圾收集 ============

function doFindTrashs (screen) {
  if (YoloDetectionUtil.enabled) {
    let findBalls = YoloDetectionUtil.forward(screen, { labelRegex: 'sea_garbage|collect', confidence: config.yolo_confidence || 0.7 })
    if (findBalls && findBalls.length > 0) {
      findBalls.sort((a, b) => a.label == 'collect' ? 1 : -1)
    }
    return findBalls
  } else {
    let grayImgInfo = images.grayscale(images.medianBlur(screen, 5))
    let findBalls = images.findCircles(
      grayImgInfo,
      {
        param1: config.hough_param1 || 30,
        param2: config.hough_param2 || 30,
        minRadius: config.sea_ball_radius_min || cvt(20),
        maxRadius: config.sea_ball_radius_max || cvt(35),
        minDst: config.hough_min_dst || cvt(100),
        region: config.sea_ball_region
      }
    )
    findBalls = findBalls.map(ball => {
      ball.x = ball.x + config.sea_ball_region[0]
      ball.y = ball.y + config.sea_ball_region[1]
      return ball
    })
    return findBalls
  }
}

/**
 * 收集自己的垃圾
 */
function collectSelfTrash () {
  taskLog('开始收集自己的垃圾')
  FloatyInstance.setFloatyInfo({ x: config.device_width / 2, y: config.device_height / 2 }, '找垃圾球中...')
  sleep(3000)

  let screen = commonFunction.checkCaptureScreenPermission()
  if (!screen) {
    taskLog('截图失败，跳过收集垃圾')
    return
  }

  let findBalls = doFindTrashs(screen)
  taskLog('找到的球：' + JSON.stringify(findBalls))

  // 先收自己的能量球
  if (!config.not_collect_self) {
    let energyBalls = findBalls.filter(ball => ball.label == 'collect')
    if (energyBalls && energyBalls.length > 0) {
      taskLog('找到能量球：' + JSON.stringify(energyBalls))
      energyBalls.forEach(ball => {
        clickPoint(ball.x + ball.width / 2, ball.y + ball.height / 2)
        sleep(100)
      })
    }
  }

  // 过滤垃圾球
  if (YoloDetectionUtil.enabled) {
    findBalls = findBalls.filter(ball => ball.label == 'sea_garbage')
  }

  if (findBalls && findBalls.length > 0) {
    YoloTrainHelper.saveImage(screen, '有垃圾球', 'sea_ball', config.sea_ball_train_save_data)
    screen.recycle()

    let ball = findBalls[0]
    FloatyInstance.setFloatyInfo({ x: ball.x, y: ball.y }, '找到了垃圾')
    sleep(500)

    if (!YoloDetectionUtil.enabled) {
      let clickPos = { x: ball.x - ball.radius * 1.5, y: ball.y + ball.radius * 1.5 }
      FloatyInstance.setFloatyInfo(clickPos, '点击位置')
      sleep(2000)
      clickPoint(clickPos.x, clickPos.y)
    } else {
      FloatyInstance.setFloatyInfo({ x: ball.centerX, y: ball.centerY }, '点击位置')
      clickPoint(ball.centerX, ball.centerY)
    }
    sleep(1000)

    // 处理弹窗：收下|回到我的海洋
    let collect = widgetUtils.widgetGetOne('.*(收下|回到我的海洋|清理|.*不.*了.*).*')
    if (collect) {
      clickPoint(collect.bounds().centerX(), collect.bounds().centerY())
      // 递归继续找
      sleep(1500)
      collectSelfTrash()
    }
  } else {
    FloatyInstance.setFloatyText('未找到垃圾球')
    YoloTrainHelper.saveImage(screen, '无垃圾球', 'sea_ball', config.sea_ball_train_save_data)
    screen.recycle()
  }
}

// ============ 奖励领取和任务分支 ============

/**
 * 领取奖励：查找并点击"立即领取"
 */
function tryClickClaim () {
  taskLog('查找"立即领取"按钮')

  // 优先控件查找
  try {
    let allNodes = className('android.widget.Button').find()
    if (allNodes) {
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let t = node.text()
          if (t && t.toString().indexOf('立即领取') >= 0) {
            let bounds = node.bounds()
            taskLog('控件找到"立即领取": 点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
            automator.click(bounds.centerX(), bounds.centerY())
            sleep(2000)
            // 处理弹窗
            handlePopupDialog()
            return true
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    taskLog('控件查找"立即领取"异常: ' + e)
  }

  // OCR兜底
  if (localOcrUtil.enabled) {
    taskLog('控件未找到，尝试OCR识别"立即领取"')
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let results = localOcrUtil.recognizeWithBounds(screen, [0, 0, config.device_width, config.device_height], '立即领取')
      screen.recycle()
      if (results && results.length > 0) {
        for (let r = 0; r < results.length; r++) {
          let match = results[r]
          if (match.label.indexOf('立即领取') >= 0) {
            let bounds = match.bounds
            taskLog('OCR找到"立即领取": 点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
            automator.click(bounds.centerX(), bounds.centerY())
            sleep(2000)
            handlePopupDialog()
            return true
          }
        }
      }
    }
  }

  return false
}

/**
 * "去清理"分支：收集好友垃圾
 */
function doCleanTask (bounds) {
  taskLog('执行"去清理"任务')
  automator.click(bounds.centerX(), bounds.centerY())
  sleep(2000)
  handlePopupDialog()
  sleep(2000)

  // 收集好友垃圾（与收集自己垃圾逻辑类似，但弹窗为"清理掉"）
  taskLog('开始收集好友垃圾')
  let screen = commonFunction.checkCaptureScreenPermission()
  if (screen) {
    let findBalls = doFindTrashs(screen)
    if (findBalls && findBalls.length > 0) {
      let ball = findBalls[0]
      if (!YoloDetectionUtil.enabled) {
        let clickPos = { x: ball.x - ball.radius * 1.5, y: ball.y + ball.radius * 1.5 }
        clickPoint(clickPos.x, clickPos.y)
      } else {
        clickPoint(ball.centerX, ball.centerY)
      }
      sleep(1000)
      // 弹窗为"清理掉"
      let collect = widgetUtils.widgetGetOne('.*(清理掉|收下|.*不.*了.*).*')
      if (collect) {
        clickPoint(collect.bounds().centerX(), collect.bounds().centerY())
      }
    }
    screen.recycle()
  }

  // 重新打开神奇海洋进入奖励页面
  reopenSeaAndRewardPage()
}

/**
 * "去看看"分支
 */
function doLookTask (bounds) {
  taskLog('执行"去看看"任务')
  let hasCountdown = hasCountdownInSameRow(bounds)
  let hasMarket = hasTextInSameRow(bounds, '逛一逛市集')

  if (hasCountdown && hasMarket) {
    // 有倒计时且含"逛一逛市集" → 滑动浏览
    taskLog('检测到"逛一逛市集"，执行滑动浏览')
    automator.click(bounds.centerX(), bounds.centerY())
    sleep(2000)
    handlePopupDialog()

    // 等待页面加载
    widgetUtils.widgetWaiting('滑动浏览得抽奖机会', 3000)
    sleep(1000)

    taskLog('开始自动滑动浏览')
    for (let s = 8; s > 0; s--) {
      taskLog('逛一逛 剩余：' + s + 's')
      if (s % 2 == 0) {
        automator.randomScrollDown()
      } else {
        automator.randomScrollUp()
      }
      // 每次滑动后检查弹窗
      let abandonTarget = widgetUtils.widgetGetOne('放弃奖励', 800)
      if (abandonTarget) {
        taskLog('检测到弹窗，点击"放弃奖励"')
        abandonTarget.click()
        sleep(1000)
      }
      sleep(1000)
    }
    sleep(2000)
    // 滑动结束后再检查一次弹窗
    let abandonTarget = widgetUtils.widgetGetOne('放弃奖励', 1000)
    if (abandonTarget) {
      taskLog('检测到弹窗，点击"放弃奖励"')
      abandonTarget.click()
      sleep(1000)
    }
    automator.back()
    sleep(1000)
  } else if (hasCountdown && !hasMarket) {
    // 有倒计时但不含"逛一逛市集" → 等待35s
    taskLog('检测到倒计时但不含"逛一逛市集"，等待35秒')
    automator.click(bounds.centerX(), bounds.centerY())
    sleep(2000)
    handlePopupDialog()
    sleep(35000)
  } else {
    // 其他 → 等待2s
    taskLog('其他"去看看"，等待2秒')
    automator.click(bounds.centerX(), bounds.centerY())
    sleep(2000)
    handlePopupDialog()
    sleep(2000)
  }

  reopenSeaAndRewardPage()
}

/**
 * "去答题"分支
 */
function doQuizTask (bounds) {
  taskLog('执行"去答题"任务')
  automator.click(bounds.centerX(), bounds.centerY())
  sleep(2000)
  handlePopupDialog()
  sleep(2000)

  // 选择第一个选项
  taskLog('选择第一个选项')
  try {
    let allNodes = className('android.widget.Button').find()
    if (allNodes) {
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let text = getNodeText(node)
          // 找到第一个选项按钮（通常是A/B/C/D或数字选项）
          if (text && (text.length <= 3 || /^[A-D]\)/.test(text) || /^[①②③④]/.test(text))) {
            let nodeBounds = node.bounds()
            // 检查是否在屏幕中间区域（答题区域）
            if (nodeBounds.centerY() > config.device_height * 0.3 && nodeBounds.centerY() < config.device_height * 0.8) {
              taskLog('点击选项: ' + text)
              automator.clickCenter(node)
              sleep(1000)
              break
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    taskLog('查找选项异常: ' + e)
  }

  // 返回
  sleep(1000)
  handlePopupDialog()
  goBack()
  sleep(1000)

  reopenSeaAndRewardPage()
}

/**
 * "去逛逛"分支
 */
function doStrollTask (bounds) {
  taskLog('执行"去逛逛"任务')
  let hasCountdown = hasCountdownInSameRow(bounds)

  if (hasCountdown) {
    // 有倒计时 → 等待20s
    taskLog('检测到倒计时，等待20秒')
    automator.click(bounds.centerX(), bounds.centerY())
    sleep(2000)
    handlePopupDialog()
    sleep(20000)
  } else {
    // 无倒计时 → 等待2s
    taskLog('无倒计时，等待2秒')
    automator.click(bounds.centerX(), bounds.centerY())
    sleep(2000)
    handlePopupDialog()
    sleep(2000)
  }

  reopenSeaAndRewardPage()
}

/**
 * 查找并执行任务分支
 * 返回是否找到了并执行了任务
 */
function findAndExecuteTask () {
  taskLog('通过控件查找任务按钮')
  let excludeTexts = ['去快手看蚂蚁森林', '闯关', '连续3天来海洋']

  try {
    let allNodes = className('android.widget.Button').find()
    if (!allNodes || allNodes.size() === 0) {
      allNodes = className('android.view.View').find()
    }
    if (!allNodes) return false

    for (let i = 0; i < allNodes.size(); i++) {
      try {
        let node = allNodes.get(i)
        let t = node.text() || node.desc()
        if (!t) continue
        let text = t.toString()
        let bounds = node.bounds()

        // 检查排除项
        if (hasExclusion(bounds, excludeTexts)) continue

        // "去清理"分支
        if (text.indexOf('去清理') >= 0) {
          taskLog('找到"去清理"任务')
          doCleanTask(bounds)
          return true
        }

        // "去看看"分支
        if (text.indexOf('去看看') >= 0) {
          taskLog('找到"去看看"任务')
          doLookTask(bounds)
          return true
        }

        // "去答题"分支
        if (text.indexOf('去答题') >= 0) {
          taskLog('找到"去答题"任务')
          doQuizTask(bounds)
          return true
        }

        // "去逛逛"分支
        if (text.indexOf('去逛逛') >= 0) {
          taskLog('找到"去逛逛"任务')
          doStrollTask(bounds)
          return true
        }
      } catch (e) {}
    }
  } catch (e) {
    taskLog('控件查找任务异常: ' + e)
  }

  taskLog('未找到可执行的任务按钮')
  return false
}

// ============ 主流程 ============

function main () {
  infoLog('神奇海洋脚本启动', true)

  // 1. 打开神奇海洋
  openMiracleOcean()

  // 2. 收集自己的垃圾
  collectSelfTrash()

  // 3. 进入奖励页面
  taskLog('进入奖励页面')
  enterRewardPage()
  sleep(2000)

  // 4. 主循环：领取奖励 + 执行任务
  let maxRounds = 30
  for (let round = 0; round < maxRounds; round++) {
    taskLog('=== 神奇海洋 第 ' + (round + 1) + ' 轮 ===')

    // 领取奖励（最多执行2次）
    for (let c = 0; c < 2; c++) {
      try {
        if (!tryClickClaim()) break
        taskLog('第' + (round + 1) + '轮: 点击领取成功(第' + (c + 1) + '次)')
      } catch (e) {
        let errMsg = e && e.message ? e.message : e
        errorInfo('点击领取异常: ' + errMsg)
      }
    }

    // 执行任务分支
    taskLog('尝试执行任务')
    try {
      if (findAndExecuteTask()) {
        taskLog('执行任务成功，继续下一轮')
        continue
      }
    } catch (e) {
      let errMsg = e && e.message ? e.message : e
      errorInfo('执行任务异常: ' + errMsg)
      try {
        reopenSeaAndRewardPage()
      } catch (e2) {}
      continue
    }

    // 没有匹配到任何内容，退出
    taskLog('没有更多任务可执行，退出神奇海洋')
    break
  }

  // 返回
  taskLog('神奇海洋任务完成，返回')
  commonFunction.minimize()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

main()
