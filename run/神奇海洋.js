/*
 * 神奇海洋核心脚本
 * 架构：
 * 1. 进入神奇海洋 → 判断是否在神奇海洋界面，不在则报错退出
 * 2. 在则收集自己的垃圾
 * 3. 收集完进入奖励页面，执行任务
 * 4. 主循环：领取奖励（立即领取）+ 探索任务（EXPLORE_BUTTONS）
 *    - 排除项 SKIP_KEYWORDS 同行则跳过
 *    - 特殊任务 SPECIAL_TASKS 走对应分支
 *    - 浏览数组：同行匹配到 \d+s 则浏览 \d+2s
 *    - 长等待关键词 LONG_WAIT_KEYWORDS 同行命中则等待15s
 *    - 任务完成后 waitForTaskComplete 回到奖励页面
 *    - 无任务可执行时滑动继续查找，直到检测到"更多任务，敬请期待"或滑动达上限（maxScrolls）退出
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
let OpenCvUtil = require('../lib/OpenCvUtil.js')
let widgetInspector = require('../lib/WidgetInspector.js')(runtime, global)
let killProcessUtil = require('../lib/KillProcessUtil.js')
let SwitchToApp = require('../lib/SwitchToApp.js')(runtime, global)
let YoloDetectionUtil = singletonRequire('YoloDetectionUtil')
let YoloTrainHelper = singletonRequire('YoloTrainHelper')
let resourceMonitor = require('../lib/ResourceMonitor.js')(runtime, global)

runningQueueDispatcher.addRunningTask()

let SCALE_RATE = config.scaleRate
let cvt = (v) => parseInt(v * SCALE_RATE)
config.sea_ball_region = config.sea_ball_region || [cvt(860), cvt(1350), cvt(140), cvt(160)]

// 调试日志（悬浮窗显示）
function taskLog (msg) {
  LogFloaty.pushLog(msg)
}

function killApps () {
  try {
    killProcessUtil.killMultiple([
      { pkg: config.package_name || 'com.eg.android.AlipayGphone', name: '支付宝' },
      { pkg: 'com.taobao.taobao', name: '淘宝' },
      { pkg: 'com.sankuai.meituan', name: '美团' },
      { pkg: 'com.taobao.idlefish', name: '闲鱼' },
      { pkg: 'com.taobao.etao', name: '一淘' },
      { pkg: 'com.taobao.trip', name: '飞猪' },
      { pkg: 'com.autonavi.minimap', name: '高德地图' },
      { pkg: 'com.taobao.live', name: '点淘' },
      { pkg: 'com.baidu.searchbox.lite', name: '百度极速版' },
      { pkg: 'com.jifen.qukan', name: '趣头条' }
    ], function(name, success) {
      taskLog(name + ' → ' + (success ? '✓ 已杀掉' : '✗ 失败'))
    })
  } catch (e) {
    taskLog('kill进程失败: ' + e)
  }
}

/**
 * 结束神奇海洋：返回原页面并清理
 */
function exitScript () {
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exitScript()
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

// ============ 工具函数 ============

function clickPoint (x, y) {
  automator.click(x, y)
}

function goBack () {
  back()
  sleep(2000)
}

function sleepIfNeeded (time) {
  if (time > 0) {
    sleep(time)
  }
}

// 遍历可见区域内的控件，用正则 pattern 匹配文本，匹配到第一个符合条件的节点即点击并返回 true；未匹配到返回 false
function findAndClickByTextVisible (pattern) {
  let result = widgetInspector.detectAllNodesVisible()
  for (let node of result.nodes) {
    if (pattern.test(node.text)) {
      let bd = node.bounds
      if (bd) {
        taskLog('找到"' + node.text + '"，点击: (' + bd.centerX() + ', ' + bd.centerY() + ')')
        automator.click(bd.centerX(), bd.centerY())
        return true
      }
    }
  }
  return false
}

// 通过OCR识别并点击指定关键词
// 在 timeout 时间内循环截屏识别，命中即点击返回 true
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
        taskLog('OCR找到"' + keyword + '"，点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
        automator.click(match.bounds.centerX(), match.bounds.centerY())
        sleep(500)
        return true
      }
    }
    sleep(500)
  }
  return false
}

/**
 * 通过模板图片匹配指定 key 的图标并点击
 * 模板未配置或匹配失败时回退到 OCR 识别
 * @param {string} templateKey - config.image_config 中的模板 key（如 ocean_reward_icon）
 * @param {string} ocrText - OCR 兜底识别的文字（如 "奖励"）
 * @returns {boolean} 是否成功找到并点击
 */
function clickByTemplateOrOcr (templateKey, ocrText) {
  // 方案1：模板图片匹配（优先）
  if (config.image_config && config.image_config[templateKey]) {
    try {
      let screen = commonFunction.captureScreen()
      if (screen) {
        let match = OpenCvUtil.findByGrayBase64(screen, config.image_config[templateKey], false)
        if (match) {
          let centerX = Math.round(match.centerX())
          let centerY = Math.round(match.centerY())
          taskLog('模板匹配找到"' + ocrText + '"(' + templateKey + '): 点击: (' + centerX + ', ' + centerY + ')')
          automator.click(centerX, centerY)
          sleep(2000)
          return true
        }
        taskLog('模板匹配未找到"' + ocrText + '"(' + templateKey + ')，回退到OCR')
      } else {
        taskLog('截屏失败，回退到OCR')
      }
    } catch (e) {
      taskLog('模板匹配异常: ' + e + '，回退到OCR')
    }
  } else {
    taskLog('未配置' + templateKey + '模板，使用OCR')
  }

  // 方案2：OCR识别（兜底，直接调用 clickByOcr，带重试机制）
  taskLog('通过OCR识别"' + ocrText + '"')
  return clickByOcr(ocrText, 3000)
}

// 打开进入神奇海洋的函数
function openOcean () {
  taskLog('进入神奇海洋')

  commonFunction.backHomeIfInVideoPackage()

  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=2021003115672468',
    packageName: config.package_name
  })

  // 处理"打开"确认弹窗
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 1000)
  if (confirm) {
    automator.clickCenter(confirm)
  }

  commonFunction.readyForAlipayWidgets()

  // 等待进入神奇海洋页面
  sleep(2000)
  if (!isOnOceanPage()) {
    LogFloaty.pushErrorLog('不在神奇海洋页面，退出脚本')
    return false
  }
  taskLog('进入神奇海洋成功')
  return true
}

// 判断是否在神奇海洋界面（全部文本都检测到才算成功，支持通配符；完全匹配用 ^xxx$）
// 匹配文本："蚂蚁森林.*神奇海洋"(非完全) ".*前去参与保护项目"(非完全) "返回"(完全)
function isOnOceanPage () {
  let texts = ['蚂蚁森林.*神奇海洋', '.*前去参与保护项目', '^返回$']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], texts[i], 5000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在神奇海洋界面')
      return false
    }
    taskLog('检测到"' + texts[i] + '"')
  }
  taskLog('全部文本检测到，确认在神奇海洋界面')
  sleep(4000) // 等待界面加载完成
  return true
}

// 判断是否在奖励页面（全部文本都检测到才算成功，支持通配符；完全匹配用 ^xxx$）
// 匹配文本："蚂蚁森林.*神奇海洋"(非完全) "关闭"(非完全) "任务图标"(非完全)
function isOnRewardPage () {
  let texts = ['蚂蚁森林.*神奇海洋', '关闭', '任务图标']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], texts[i], 5000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在奖励页面')
      return false
    }
    taskLog('检测到"' + texts[i] + '"')
  }
  taskLog('全部文本检测到，确认在奖励页面')
  sleep(4000) // 等待界面加载完成
  return true
}

// 判断是否在好友的神奇海洋界面（全部文本都检测到才算成功）
// 匹配文本："蚂蚁森林.*神奇海洋"(非完全) ".*的神奇海洋"(非完全)
function isOnFriendPage () {
  let texts = ['蚂蚁森林.*神奇海洋', '.*的神奇海洋']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], texts[i], 5000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在好友神奇海洋界面')
      return false
    }
    taskLog('检测到"' + texts[i] + '"')
  }
  taskLog('全部文本检测到，确认在好友神奇海洋界面')
  sleep(3000) // 等待界面加载完成
  return true
}

/**
 * 处理弹窗：检测"收下|回到我的海洋|返回"（收集垃圾/领取奖励用，与收集垃圾保持一致，不检查系统"打开"弹窗）
 */
function handleCollectPopup () {
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

  // 查找"返回"按钮
  btn = widgetUtils.widgetGetOne(/^返回$/, 2000)
  if (btn) {
    taskLog('检测到"返回"弹窗')
    automator.clickCenter(btn)
    sleep(1000)
    return true
  }

  // 查找"回到我的海洋"按钮（放在最后）
  btn = widgetUtils.widgetGetOne(/^回到我的海洋$/, 2000)
  if (btn) {
    taskLog('检测到"回到我的海洋"弹窗')
    automator.clickCenter(btn)
    sleep(1000)
    return true
  }

  // 查找"欢迎伙伴回家"按钮（放在最后）
  btn = widgetUtils.widgetGetOne(/^欢迎伙伴回家$/, 2000)
  if (btn) {
    taskLog('检测到"欢迎伙伴回家"弹窗')
    automator.clickCenter(btn)
    sleep(1000)
    return true
  }

  taskLog('未检测到弹窗')
  return false
}

/**
 * 处理弹窗：检测"打开|支付宝想要打开xxx"系统弹窗
 */
function handleTaskPopup () {
  taskLog('检查是否有弹窗')
  sleep(500)
  let openBtn = widgetUtils.widgetGetOne(/^打开$/, 2000)
  if (openBtn) {
    taskLog('检测到系统弹窗，点击"打开"')
    automator.clickCenter(openBtn)
    sleep(2000)
    return true
  }
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
        taskLog('检测到"支付宝想要打开xxx"弹窗，点击"打开"')
        automator.clickCenter(openButton)
        sleep(2000)
        return true
      }
    }
  } catch (e) {
    taskLog('检查弹窗异常: ' + e)
  }
  taskLog('未检测到弹窗')
  return false
}

// ============ 进入奖励页面 ============

/**
 * 进入奖励页面
 * 模板匹配 ocean_reward_icon "奖励"（OCR兜底）
 * 注意：不包含打开神奇海洋，调用前需确保已在神奇海洋界面
 */
function enterRewardPage () {
  taskLog('进入奖励页面')

  // 模板匹配 ocean_reward_icon "奖励"（OCR兜底）
  if (clickByTemplateOrOcr('ocean_reward_icon', '奖励')) {
    taskLog('已点击"奖励"')
    return true
  }

  LogFloaty.pushErrorLog('未找到"奖励"入口，进入奖励页面失败')
  return false
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

/**
 * 收集一次垃圾（用于"帮好友清理垃圾"，只收集一次不递归）
 */
function collectFriendTrashOnce () {
  taskLog('开始收集垃圾（仅一次）')
  sleep(2000)

  let screen = commonFunction.checkCaptureScreenPermission()
  if (!screen) {
    taskLog('截图失败，跳过收集垃圾')
    return
  }

  let findBalls = doFindTrashs(screen)
  taskLog('找到的球：' + JSON.stringify(findBalls))

  if (findBalls && findBalls.length > 0) {
    let ball = findBalls[0]
    if (!YoloDetectionUtil.enabled) {
      let clickPos = { x: ball.x - ball.radius * 1.5, y: ball.y + ball.radius * 1.5 }
      clickPoint(clickPos.x, clickPos.y)
    } else {
      clickPoint(ball.centerX, ball.centerY)
    }
    sleep(1000)

    // 处理弹窗：收下|回到我的海洋|清理掉
    let collect = widgetUtils.widgetGetOne('.*(收下|回到我的海洋|清理掉|.*不.*了.*).*')
    if (collect) {
      clickPoint(collect.bounds().centerX(), collect.bounds().centerY())
      sleep(1000)
    }
  } else {
    taskLog('未找到垃圾球')
  }
  screen.recycle()
}

// ============ 任务常量 ============

// 特殊任务：匹配到则走对应分支
const SPECIAL_TASKS = [
  { keyword: '逛一逛市集', action: 'marketBrowse' },
  { keyword: '帮好友清理垃圾', action: 'friendClean' },
  { keyword: '答题学海洋知识', action: 'quiz' },
  { keyword: '逛一逛点淘', action: 'clickTarget', clickTarget: '打开APP', waitTime: 15000 }
]

// 排除项：按钮同行包含任一关键词则跳过
const SKIP_KEYWORDS = ['去快手看蚂蚁森林', '逛一逛百度地图', '随机获得海洋伙伴线索拼图2块', '连续3天来海洋', '玩一玩得拼图', '随机获得海洋伙伴线索拼图3块']

// 长等待关键词：普通任务同行命中则等待15s
const LONG_WAIT_KEYWORDS = ['逛一逛闲鱼', '去淘宝看科普视频']

// 探索任务按钮（完全匹配）
const EXPLORE_BUTTONS = ['去看看', '去逛逛', '去完成', '去答题']

// ============ 任务执行 ============

// 查找同行内是否命中排除项（逐节点判断，阈值200）
function findSkipInSameRow (allNodes, centerY, keywords) {
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    for (let kw of keywords) {
      if (text.indexOf(kw) >= 0) {
        let y = node.bounds.centerY()
        if (Math.abs(y - centerY) < 200) {
          return text
        }
      }
    }
  }
  return null
}

// 查找同行内是否命中特殊任务（逐节点判断，阈值200）
function findSpecialTaskInSameRow (allNodes, centerY) {
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    for (let st of SPECIAL_TASKS) {
      if (text.indexOf(st.keyword) >= 0) {
        let y = node.bounds.centerY()
        if (Math.abs(y - centerY) < 200) {
          return st
        }
      }
    }
  }
  return null
}

// 查找同行内是否匹配到 \d+s（浏览数组），返回秒数；未匹配返回 -1
function findBrowseSecondsInSameRow (allNodes, centerY) {
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    let m = text.match(/(\d+)s/)
    if (m && Math.abs(node.bounds.centerY() - centerY) < 200) {
      return parseInt(m[1])
    }
  }
  return -1
}

// 查找同行内是否命中长等待关键词，命中返回15000，否则返回2000
function getWaitTimeForSameRow (allNodes, centerY) {
  for (let node of allNodes) {
    let text = node.text
    if (!text) continue
    for (let kw of LONG_WAIT_KEYWORDS) {
      if (text.indexOf(kw) >= 0) {
        let y = node.bounds.centerY()
        if (Math.abs(y - centerY) < 200) {
          taskLog('附近有"' + text + '"任务，等待15秒')
          return 15000
        }
      }
    }
  }
  return 2000
}

// 特殊任务：逛一逛市集（仿森林寻宝 executeMarketBrowse，while循环等待任务出现）
function executeMarketBrowse () {
  taskLog('开始自动滑动浏览')
  // while中等待"滑动浏览得拼图"，检测不到则视为任务已完成，退出循环
  while (widgetUtils.widgetGetOne('滑动浏览得拼图', 1000)) {
    // 滑动10轮
    for (let s = 10; s > 0; s--) {
      let start = new Date().getTime()
      if (s % 2 == 0) {
        automator.randomScrollDown()
      } else {
        automator.randomScrollUp()
      }
      // 每次滑动后检查弹窗（用OCR识别"放弃奖励"，短超时控制阻塞）
      clickByOcr('放弃奖励', 800)
      sleepIfNeeded(1000 - (new Date().getTime() - start))
    }
    // 滑动结束后再检查一次弹窗（用OCR识别"放弃奖励"）
    taskLog('检查是否有弹窗需要关闭')
    clickByOcr('放弃奖励', 2000)
    // 下一轮while会重新检测"滑动浏览得拼图"，检测不到则退出（视为已完成）
  }
}

// 特殊任务：帮好友清理垃圾
function executeFriendCleanTask () {
  taskLog('执行"帮好友清理垃圾"')

  // 判断是否在好友界面
  if (!isOnFriendPage()) {
    taskLog('不在好友神奇海洋界面')
    return
  }

  // 仅收集一次垃圾
  collectFriendTrashOnce()

  // 返回后即回到神奇海洋界面，直接进入奖励页面
  goBack()
  sleep(1000)
  if (!enterRewardPage()) {
    taskLog('进入奖励页面失败')
  }
}

// 特殊任务：答题学海洋知识
function executeQuizTask () {
  taskLog('执行"答题学海洋知识"')

  sleep(2000)
  handleTaskPopup()

  // 点击"题目来源.*" textview 上方的第一个 textview
  try {
    let allTextViews = className('android.widget.TextView').find()
    if (allTextViews) {
      let sourceNode = null
      for (let i = 0; i < allTextViews.size(); i++) {
        let tv = allTextViews.get(i)
        try {
          let t = tv.text()
          if (t && /^题目来源.*/.test(t.toString())) {
            sourceNode = tv
            break
          }
        } catch (e) {}
      }
      if (sourceNode) {
        let sourceBounds = sourceNode.bounds()
        // 找"题目来源"上方的第一个 textview
        let targetNode = null
        for (let i = 0; i < allTextViews.size(); i++) {
          let tv = allTextViews.get(i)
          try {
            let tb = tv.bounds()
            if (tb.centerY() < sourceBounds.centerY()) {
              if (!targetNode || tb.centerY() > targetNode.bounds().centerY()) {
                targetNode = tv
              }
            }
          } catch (e) {}
        }
        if (targetNode) {
          taskLog('点击"题目来源"上方的textview')
          automator.clickCenter(targetNode)
          sleep(1000)
        } else {
          taskLog('未找到"题目来源"上方的textview')
        }
      } else {
        taskLog('未找到"题目来源"文本')
      }
    }
  } catch (e) {
    taskLog('答题任务异常: ' + e)
  }

  // 返回
  sleep(1000)
  handleTaskPopup()
  goBack()
  sleep(1000)
}

/**
 * 执行 clickTarget 特殊任务
 * 用于“逛一逛点淘”等需要点击“打开APP”的任务
 * 点击后按 waitTime 等待
 */
function executeClickTargetTask (specialTask) {
  taskLog('执行特殊任务: ' + specialTask.keyword)
  sleep(2000)

  if (specialTask.action === 'clickTarget' && specialTask.clickTarget) {
    let found = false
    // 控件优先识别（包含匹配，兼容"下载/打开APP"等带前缀的按钮文字）
    if (findAndClickByTextVisible(new RegExp(specialTask.clickTarget))) {
      found = true
    }
    // OCR兜底（复用clickByOcr，带重试）
    if (!found) {
      if (clickByOcr(specialTask.clickTarget, 3000)) {
        found = true
      }
    }
    if (!found) {
      taskLog('未找到"' + specialTask.clickTarget + '"')
    }
  }
}

/**
 * 等待任务完成并回到奖励页面
 * 1. 先检测当前包是否在支付宝，不在则先切入支付宝
 * 2. 走返回逻辑：先检测是否在奖励页面，不在则back，循环直到回到奖励页面
 * @returns {boolean} 是否成功回到奖励页面
 */
function waitForTaskComplete () {
  taskLog('任务完成，退出页面')
  sleep(2000)

  let pkg = config.package_name || 'com.eg.android.AlipayGphone'

  // 1. 检测当前包是否在支付宝，不在则先切入支付宝
  if (currentPackage() !== pkg) {
    taskLog('当前不在支付宝，切入支付宝')
    let switched = SwitchToApp.switchToApp({
      pkg: pkg,
      cardText: '支付宝',
      onLog: taskLog
    })
    if (!switched) {
      taskLog('切入支付宝失败，重新进入')
      commonFunction.minimize()
      sleep(500)
      // 先打开神奇海洋，再进入奖励页面
      if (!openOcean()) {
        taskLog('重新打开神奇海洋失败')
        return false
      }
      return enterRewardPage()
    }
    sleep(2000)
  }

  // 2. 返回逻辑：先检测后back，循环直到回到奖励页面
  let maxBacks = 3
  for (let i = 0; i < maxBacks; i++) {
    // 先检测是否已在奖励页面
    if (isOnRewardPage()) {
      taskLog('已回到奖励页面')
      return true
    }
    // 不在则back
    taskLog('第' + (i + 1) + '次back')
    goBack()
    sleep(2000)
  }

  taskLog('多次back后仍未回到奖励页面，重新进入')
  commonFunction.minimize()
  sleep(500)
  // 先打开神奇海洋，再进入奖励页面
  if (!openOcean()) {
    taskLog('重新打开神奇海洋失败')
    return false
  }
  return enterRewardPage()
}

// 领取所有奖励：点击所有"立即领取"，处理弹窗（无抽奖处理）
function claimAllRewards () {
  while (findAndClickByTextVisible(/^立即领取$/)) {
    sleep(2000)
    handleCollectPopup()
  }
}

// 查找并执行探索任务
function findAndExecuteExploreTask () {
  let result = widgetInspector.detectAllNodesVisible()
  let allNodes = result.nodes
  if (!allNodes || allNodes.length === 0) {
    taskLog('未检测到任何控件')
    return false
  }

  for (let node of allNodes) {
    let text = node.text
    if (!text) continue

    let isTarget = false
    for (let btn of EXPLORE_BUTTONS) {
      if (text === btn) {
        isTarget = true
        break
      }
    }
    if (!isTarget) continue

    let bd = node.bounds
    if (!bd) continue
    let centerY = bd.centerY()

    // 排除项：同行含 SKIP_KEYWORDS 则跳过
    let skipText = findSkipInSameRow(allNodes, centerY, SKIP_KEYWORDS)
    if (skipText) {
      taskLog('跳过"' + skipText + '"行的按钮: "' + text + '"')
      continue
    }

    // 特殊任务判断
    let specialTask = findSpecialTaskInSameRow(allNodes, centerY)

    taskLog('找到探索任务按钮: "' + text + '" 点击: (' + bd.centerX() + ', ' + bd.centerY() + ')')
    automator.click(bd.centerX(), bd.centerY())
    sleep(2000)
    handleTaskPopup()

    if (specialTask) {
      taskLog('走特殊任务分支: ' + specialTask.keyword)
      if (specialTask.action === 'marketBrowse') {
        executeMarketBrowse()
      } else if (specialTask.action === 'friendClean') {
        executeFriendCleanTask()
      } else if (specialTask.action === 'quiz') {
        executeQuizTask()
      } else if (specialTask.action === 'clickTarget') {
        executeClickTargetTask(specialTask)
        if (specialTask.waitTime > 0) {
          sleep(specialTask.waitTime)
        }
      }
    } else {
      // 普通任务：同行匹配到 \d+s 则浏览 \d+2s，否则按同行关键词等待（长等待15s，默认2s）
      let browseSeconds = findBrowseSecondsInSameRow(allNodes, centerY)
      if (browseSeconds > 0) {
        let waitTime = (browseSeconds + 2) * 1000
        taskLog('同行匹配到' + browseSeconds + 's，浏览 ' + (browseSeconds + 2) + 's')
        sleep(waitTime)
      } else {
        let waitTime = getWaitTimeForSameRow(allNodes, centerY)
        taskLog('普通任务，等待' + (waitTime / 1000) + 's')
        sleep(waitTime)
      }
    }

    taskLog('任务执行完毕，等待回到奖励页面')
    return waitForTaskComplete()
  }

  taskLog('未找到可执行的探索任务')
  return false
}

// ============ 主流程 ============

function main () {
  infoLog('运行中可按音量上键关闭', true)
  threads.start(function () {
    events.observeKey()
    events.on("key_down", function (keyCode, event) {
      if (keyCode === 24) {
        toastLog('用户按音量上键，退出脚本')
        killApps()
        runningQueueDispatcher.removeRunningTask()
        exit()
      }
    })
  })

  // 1. 进入神奇海洋，判断是否在神奇海洋界面
  if (!openOcean()) {
    errorInfo('无法进入神奇海洋，退出神奇海洋')
    exitScript()
  }

  // 2. 收集自己的垃圾
  collectSelfTrash()

  // 3. 进入奖励页面
  taskLog('进入奖励页面')
  if (!enterRewardPage()) {
    errorInfo('无法进入奖励页面，退出神奇海洋')
    exitScript()
  }

  // 4. 主循环：领取奖励 + 执行任务，无任务可执行时滑动继续查找，直到检测到"更多任务，敬请期待"或滑动达上限（maxScrolls）退出
  let maxScrolls = 15   // 滑动上限，防止死循环
  let scrollCount = 0
  let round = 0
  while (true) {
    round++
    taskLog('=== 神奇海洋 第 ' + round + ' 轮 ===')

    // 领取所有奖励
    claimAllRewards()

    // 判断是否在奖励页面，不在则重进神奇海洋再进入奖励页面
    if (!isOnRewardPage()) {
      taskLog('不在奖励页面，重新打开神奇海洋进入奖励页面')
      // 重进神奇海洋
      if (!openOcean()) {
        errorInfo('重新打开神奇海洋失败，退出神奇海洋')
        exitScript()
      }
      // 再进入奖励页面
      if (!enterRewardPage()) {
        errorInfo('重新进入奖励页面失败，退出神奇海洋')
        exitScript()
      }
    }

    // 执行探索任务
    taskLog('尝试探索任务')
    try {
      if (findAndExecuteExploreTask()) {
        taskLog('探索任务执行完毕，继续下一轮')
        scrollCount = 0   // 执行了任务，重置滑动计数
        continue
      }
    } catch (e) {
      let errMsg = e && e.message ? e.message : e
      errorInfo('探索任务异常: ' + errMsg)
      commonFunction.minimize()
      sleep(500)
      // 先打开神奇海洋，再进入奖励页面
      if (openOcean() && enterRewardPage()) {
        continue
      } else {
        errorInfo('重新进入奖励页面失败，退出神奇海洋')
        exitScript()
      }
    }

    // 没有可执行任务：检查是否滑到底部（找到"更多任务，敬请期待"）
    let result = widgetInspector.detectAllNodesVisible()
    let hasEnd = result.nodes.some(n => /更多任务，敬请期待/.test(n.text))
    if (hasEnd) {
      taskLog('已滑到底部（找到"更多任务，敬请期待"），退出神奇海洋')
      break
    }

    // 未到底：滑动继续查找
    if (scrollCount >= maxScrolls) {
      taskLog('滑动已达上限，退出神奇海洋')
      break
    }
    scrollCount++
    taskLog('没有更多任务可执行，滑动屏幕继续查找')
    let h = config.device_height
    // 下滑：起始75%~85%随机，距离15%~20%随机，startY大值 endY小值
    let downStart = (0.75 + Math.random() * 0.10) * h
    let downDist = (0.15 + Math.random() * 0.05) * h
    let downDuration = 100 + Math.random() * 300
    automator.gestureDown(Math.round(downStart), Math.round(downStart - downDist), downDuration)
    sleep(1000)
  }

  taskLog('神奇海洋任务完成，返回')
  exitScript()
}

main()
