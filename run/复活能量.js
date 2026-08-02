/*
 * @Author: Auto-generated for Ant-Forest
 * @Description: 复活能量子脚本
 * 复活好友能量，每次获得5g
 *
 * 流程（一直循环，直到复活6次、找不到+5g或进入总榜失败退出）：
 *   1. 进入蚂蚁森林 → 收取自己能量
 *   2. 进入总能量榜（下滑找"查看更多好友"，点击后确认在总榜，最多重试5次）
 *   3. 查找+5g（优先模板图片匹配 rebirth_5g.data，失败回退findColor找橙色#FF8F00），连续2次没找到检查"没有更多了"
 *      找到后取第一个，进入好友森林复活
 *   4. 复活满6次则退出，否则回到步骤1
 *
 * 控件查找：findAndClickByTextVisible（WidgetInspector.detectAllNodesVisible）
 * +5g查找：findOrangeMarkers（优先模板图片匹配 rebirth_5g.data，失败回退findColor找按钮内第一个橙色点，再从右下(x+1,y+1)找相邻点算中心）
 * 帮TA复活能量：clickReviveEnergy（OCR模糊匹配"复活/能量/立得"，限制屏幕上半部）
 * 总榜确认：checkInEnergyRank（widgetWaiting逐个检查"排行榜/日榜/周榜/总榜/总能量榜"，每个等5s）
 *
 * 退出前：再收一次能量 → minimize → killApps（仅退出时） → removeRunningTask → exit
 */
let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let args = config.parseExecArgv()
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
// 将 singletonRequire 挂到全局，供 YoloTrainHelper 等模块内部使用
singletonRequire = sRequire
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let LogFloaty = sRequire('LogFloaty')
let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let killProcessUtil = require('../lib/KillProcessUtil.js')
let widgetInspector = require('../lib/WidgetInspector.js')(runtime, global)
let OpenCvUtil = require('../lib/OpenCvUtil.js')

function killApps () {
  try {
    killProcessUtil.killMultiple([
      { pkg: config.package_name, name: '支付宝' }
    ], function(name, success) {
      taskLog(name + ' → ' + (success ? '✓ 已杀掉' : '✗ 失败'))
    })
  } catch (e) {
    taskLog('kill进程失败: ' + e)
  }
}

// YoloDetection 和 YoloTrainHelper 由 BaseScanner 内部自行加载


runningQueueDispatcher.addRunningTask()

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}

// 注册自动移除运行中任务
commonFunction.registerOnEngineRemoved(function () {
  config.resetBrightness && config.resetBrightness()
  runningQueueDispatcher.removeRunningTask(true, false, () => {
    config.isRunning = false
  })
}, 'main')

// ============ 工具函数 ============

function taskLog(msg) {
  LogFloaty.pushLog(msg)
}

function goBack() {
  back()
  sleep(800)
}

function exitScript() {
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

/**
 * 遍历所有控件，匹配文本并点击（含屏幕内判断）
 * @param {RegExp} pattern - 匹配文本的正则
 * @returns {boolean} 是否找到并点击成功
 */
function findAndClickByText(pattern) {
  let result = widgetInspector.detectAllNodes()
  for (let node of result.nodes) {
    if (pattern.test(node.text)) {
      let bd = node.bounds
      if (bd && bd.centerX() >= 0 && bd.centerX() <= config.device_width
          && bd.centerY() >= 0 && bd.centerY() <= config.device_height) {
        automator.click(bd.centerX(), bd.centerY())
        return true
      }
    }
  }
  return false
}

/**
 * 遍历可见控件（visibleToUser），匹配文本并点击
 * @param {RegExp} pattern - 匹配文本的正则
 * @returns {boolean} 是否找到并点击成功
 */
function findAndClickByTextVisible(pattern) {
  let result = widgetInspector.detectAllNodesVisible()
  for (let node of result.nodes) {
    if (pattern.test(node.text)) {
      let bd = node.bounds
      if (bd) {
        automator.click(bd.centerX(), bd.centerY())
        return true
      }
    }
  }
  return false
}

// ============ 核心功能 ============

/**
 * 检查时间是否在7:00-22:00之间
 */
function checkTimeRange() {
  let now = new Date()
  let hour = now.getHours()
  if (hour < 7 || hour >= 22) {
    taskLog('当前时间不在7:00-22:00范围内，跳过复活能量操作')
    return false
  }
  return true
}

/**
 * 进入蚂蚁森林
 */
function enterAntForest() {
  taskLog('进入蚂蚁森林')

  commonFunction.backHomeIfInVideoPackage()

  app.startActivity({
    action: 'VIEW',
    data: 'alipays://platformapi/startapp?appId=60000002',
    packageName: config.package_name
  })

  let confirm = widgetUtils.widgetGetOne(/^打开$/, 1000)
  if (confirm) {
    automator.clickCenter(confirm)
  }

  commonFunction.readyForAlipayWidgets()

  // 等待进入首页
  let waitCount = 0
  while (!widgetUtils.homePageWaiting() && waitCount++ < 10) {
    sleep(1000)
  }

  // while 退出后，waitCount >= 10 说明超时未进入首页
  if (waitCount >= 10) {
    errorInfo('进入蚂蚁森林失败')
    return false
  }
  sleep(2000)
  return true
}

/**
 * 切换到总能量榜tab（点击tab切换到排行榜视图）
 */
function clickEnergyRankTab() {
  let energyRank = widgetUtils.widgetGetById('rank-tab-energyRank', 2000)
  if (energyRank) {
    debugInfo(['通过ID找到总能量榜按钮: {}', energyRank.text()])
    energyRank.click()
    sleep(1000)
    return true
  }
  let limit = 5
  do {
    // 先查找点击，找不到再滑动
    if (findAndClickByTextVisible(/总能量榜/)) {
      sleep(1000)
      return true
    }
    let h = config.device_height
    automator.randomScrollDown(h * 0.72, h * 0.73, h * 0.42, h * 0.43)
  } while (--limit > 0)
  warnInfo('切换到总能量榜tab失败')
  return false
}

/**
 * 进入总能量榜：点击tab + 下滑找"查看更多好友"，确认在总榜，最多重试5次
 * 重试时返回后重新进入蚂蚁森林（back → 判断支付宝首页 → 点击蚂蚁森林入口）
 * @returns {boolean} 是否成功进入完整排行榜
 */
function enterEnergyRankFirstTime() {
  taskLog('进入总能量榜')

  let retryCount = 0
  while (retryCount < 5) {
    if (!clickEnergyRankTab()) {
      return false
    }
    // 下滑找"查看更多好友"，找到"你每养成一棵树"就停止
    while (true) {
      // 先查找点击，找不到再滑动
      if (findAndClickByTextVisible(/查看更多好友/)) {
        sleep(1000)
        break
      }
      // 检查是否到底
      let result = widgetInspector.detectAllNodesVisible()
      let hasEnd = result.nodes.some(n => /你每养成一棵树/.test(n.text))
      if (hasEnd) {
        warnInfo('已滑到底部未找到"查看更多好友"')
        break
      }
      let h = config.device_height
      automator.randomScrollDown(h * 0.72, h * 0.73, h * 0.42, h * 0.43)
      sleep(500)
    }

    // 点击"查看更多好友"后，检查是否在总能量榜
    if (checkInEnergyRank()) {
      return true
    }

    retryCount++
    if (retryCount < 5) {
      taskLog('返回后重新点击蚂蚁森林')
      back()
      // 等待页面完全加载
      sleep(2000)
      // 判断是否回到支付宝首页，不在则重新进入
      if (!isOnAlipayHomePage()) {
        warnInfo('未回到支付宝首页，重新进入蚂蚁森林')
        if (!enterAntForest()) {
          return false
        }
      } else {
        // 在支付宝首页，点击"蚂蚁森林"入口
        if (!findAndClickByTextVisible(/蚂蚁森林/)) {
          // 找不到"蚂蚁森林"入口，重新进入
          warnInfo('未找到"蚂蚁森林"入口，重新进入蚂蚁森林')
          if (!enterAntForest()) {
            return false
          }
        } else {
          // 点击"蚂蚁森林"后判断是否进入蚂蚁森林首页
          if (!isOnAntForestPage()) {
            warnInfo('未进入蚂蚁森林首页，重新进入蚂蚁森林')
            if (!enterAntForest()) {
              return false
            }
          }
        }
      }
      // 等待页面完全加载
      sleep(2000)
    }
  }

  warnInfo('多次尝试未进入总能量榜')
  return false
}

/**
 * 检查是否在总能量榜页面
 * 同时含有"排行榜、日榜、周榜、总榜、总能量榜"文本则视为在总榜
 * @returns {boolean} 是否在总能量榜
 */
function checkInEnergyRank() {
  let texts = ['排行榜', '日榜', '周榜', '总榜', '总能量榜']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], '总能量榜页面', 5000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在总能量榜页面')
      return false
    }
  }
  taskLog('检测到"排行榜 日榜 周榜 总榜 总能量榜"，确认在总能量榜页面')
  return true
}

/**
 * 判断是否在支付宝首页（需同时找到"扫一扫 收付款 出行 卡包 蚂蚁森林"）
 */
function isOnAlipayHomePage() {
  let texts = ['扫一扫', '收付款', '出行', '卡包', '蚂蚁森林']
  for (let i = 0; i < texts.length; i++) {
    let result = widgetUtils.widgetWaiting(texts[i], '支付宝首页', 5000)
    if (!result) {
      taskLog('未检测到"' + texts[i] + '"，不在支付宝首页')
      return false
    }
  }
  taskLog('检测到"扫一扫 收付款 出行 卡包 蚂蚁森林"，确认在支付宝首页')
  return true
}

/**
 * 判断是否在蚂蚁森林首页（需同时找到"蚂蚁森林"和"森林广场"）
 */
function isOnAntForestPage() {
  let result = widgetUtils.widgetWaiting('蚂蚁森林', '蚂蚁森林首页', 5000)
  if (!result) {
    taskLog('未检测到"蚂蚁森林"，不在蚂蚁森林界面')
    return false
  }
  let squareResult = widgetUtils.widgetWaiting('森林广场', '蚂蚁森林首页', 5000)
  if (!squareResult) {
    taskLog('未检测到"森林广场"，不在蚂蚁森林界面')
    return false
  }
  taskLog('检测到"蚂蚁森林"和"森林广场"，确认在蚂蚁森林界面')
  return true
}

/**
 * 查找+5g橙色按钮（复活能量入口）
 * 优先使用模板图片匹配（rebirth_5g.data），返回真实边界框中心，精确可靠；
 * 模板不存在或匹配失败时，回退到findColor两次匹配方案（找按钮内第一个橙色点，再从右下(x+1,y+1)找相邻点算中心）
 * @returns {Array} 橙色按钮位置列表（只含第一个按钮）
 */
function findOrangeMarkers() {
  let results = []

  try {
    let screen = commonFunction.captureScreen()
    if (!screen) {
      return results
    }

    // 方案1：模板图片匹配（优先）
    if (config.image_config && config.image_config.rebirth_5g) {
      try {
        let w = config.device_width
        // 只扫描右侧10%宽度区域，加快匹配并减少误匹配
        let region = [w * 0.9, 0, w * 0.1, config.device_height]
        let match = OpenCvUtil.findByGrayBase64(screen, config.image_config.rebirth_5g, false, region)
        if (match) {
          let centerX = Math.round(match.centerX())
          let centerY = Math.round(match.centerY())
          debugInfo(['模板匹配找到+5g按钮: 左上({}, {}) 右下({}, {}) 中心({}, {})', match.left, match.top, match.right, match.bottom, centerX, centerY])
          results.push({ centerX: centerX, centerY: centerY })
          return results
        }
        warnInfo('模板匹配未找到+5g按钮，回退到findColor')
      } catch (e) {
        warnInfo('模板匹配异常: ' + e + '，回退到findColor')
      }
      // findByGrayBase64内部已recycle screen，需重新截屏供findColor使用
      screen = commonFunction.captureScreen()
      if (!screen) {
        return results
      }
    }

    // 方案2：findColor两次匹配（兜底）
    debugInfo('使用findColor查找橙色按钮')
    let color = '#FF8F00'
    let threshold = 50
    let w = config.device_width
    // 只扫描右侧10%宽度区域
    let region = [w * 0.9, 0, w * 0.1, config.device_height]

    // 找按钮内第一个橙色点
    let firstPoint = images.findColor(screen, color, {
      region: region,
      threshold: threshold
    })
    if (firstPoint) {
      // 从第一个点右下(x+1, y+1)开始找相邻橙色点，保证是不同像素点
      let secondPoint = images.findColor(screen, color, {
        region: [firstPoint.x + 1, firstPoint.y + 1, w - (firstPoint.x + 1), config.device_height - (firstPoint.y + 1)],
        threshold: threshold
      })
      if (!secondPoint) {
        secondPoint = firstPoint
      }

      // 按钮中心 = (第一个点 + 第二个点) / 2
      let centerX = Math.round((firstPoint.x + secondPoint.x) / 2)
      let centerY = Math.round((firstPoint.y + secondPoint.y) / 2)

      debugInfo(['findColor找到橙色按钮: 点1({}, {}) 点2({}, {}) 中心({}, {})', firstPoint.x, firstPoint.y, secondPoint.x, secondPoint.y, centerX, centerY])
      results.push({
        centerX: centerX,
        centerY: centerY
      })
    }
  } catch (e) {
    warnInfo('findOrangeMarkers异常: ' + e)
  }

  return results
}

/**
 * 点击5g标志进入好友森林
 */
function clickAndEnterFriendForest(marker) {
  taskLog('点击5g标志进入好友森林，位置: (' + marker.centerX + ', ' + marker.centerY + ')')

  // 点击5g标志的位置
  automator.click(marker.centerX, marker.centerY)

  // 等待页面加载，确认进入好友首页
  if (widgetUtils.friendHomeWaiting()) {
    debugInfo('friendHomeWaiting确认进入好友森林')
    return true
  }

  warnInfo('可能未进入好友森林')
  return false
}

/**
 * 查找并点击"帮TA复活能量"
 */
function clickReviveEnergy() {
  // OCR识别"帮TA复活能量"，模糊匹配"复活""能量""立得"，限制在屏幕上半部
  if (localOcrUtil.enabled) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let ocrResult = localOcrUtil.recognizeWithBounds(screen)
      screen.recycle()
      if (ocrResult) {
        let halfH = config.device_height / 2
        for (let item of ocrResult) {
          let text = item.text || item.label || ''
          if (/复活|能量|立得/.test(text)) {
            let bd = item.bounds
            let cy = Math.round((bd.top + bd.bottom) / 2)
            if (cy < halfH) {
              let cx = Math.round((bd.left + bd.right) / 2)
              debugInfo(['OCR找到"帮TA复活能量" 位置: ({}, {})', cx, cy])
              automator.click(cx, cy)
              sleep(1500)
              return true
            }
          }
        }
      }
    }
  }

  warnInfo('未找到"帮TA复活能量"')
  return false
}

/**
 * 点击"确认发送"
 */
function clickConfirmSend() {
  if (findAndClickByTextVisible(/确认发送/)) {
    debugInfo('找到"确认发送"按钮')
    sleep(1000)
    return true
  }

  warnInfo('未找到"确认发送"按钮')
  return false
}

/**
 * 收取自己的能量（使用 BaseScanner，调用 Yolo 精准识别能量球）
 * 参考 main 中的 collectEnergy + collectOwn
 */
function collectOwnEnergy() {
  taskLog('收取自己的能量')

  // 使用 BaseScanner 收取能量
  // Yolo 不可用时自动降级为霍夫变换找圆（checkAndCollectByHough）
  let ReviveBaseScanner = require('../core/BaseScanner.js')
  let scanner = new ReviveBaseScanner()
  scanner.collectEnergy(true)
}

// ============ 主流程 ============

function main() {
  infoLog('复活能量脚本启动', true)

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

  taskLog('====== 开始复活能量流程 ======')

  let revivedCount = 0
  let roundCount = 0

  while (true) {
    roundCount++
    taskLog('第' + roundCount + '轮（已复活' + revivedCount + '次)')

    // 步骤1: 进入蚂蚁森林并收取自己的能量
    if (!enterAntForest()) {
      errorInfo('进入蚂蚁森林失败，结束脚本')
      break
    }
    collectOwnEnergy()
    sleep(1000)

    // 步骤2: 进入总能量榜
    if (!enterEnergyRankFirstTime()) {
      errorInfo('进入总能量榜失败，结束脚本')
      break
    }

    // 步骤3: 查找+5g，连续2次没找到检查"没有更多了"
    let markers = []
    findcolor:
    while (markers.length === 0) {
      for (let i = 0; i < 2; i++) {
        markers = findOrangeMarkers()
        if (markers.length > 0) break findcolor
      }
      // 检查是否有"没有更多了"文本，有的话说明到底了
      let result = widgetInspector.detectAllNodesVisible()
      let hasEnd = result.nodes.some(n => /没有更多了/.test(n.text))
      if (hasEnd) {
        warnInfo('已滑到底部未找到+5g，结束脚本')
        break
      }
      let h = config.device_height
      automator.randomScrollDown(h * 0.72, h * 0.73, h * 0.42, h * 0.43)
      sleep(600)
    }

    if (markers.length === 0) {
      warnInfo('未找到+5g，结束脚本')
      break
    }

    // 取第一个+5g进入好友森林复活
    if (clickAndEnterFriendForest(markers[0])) {
      sleep(1000)
      if (clickReviveEnergy()) {
        if (clickConfirmSend()) {
          revivedCount++
          taskLog('成功复活，累计' + revivedCount + '次)')
          if (revivedCount >= 6) {
            taskLog('已复活6次，结束流程')
            break
          }
        } else {
          warnInfo('确认发送失败')
        }
      } else {
        warnInfo('未找到"帮TA复活能量"')
      }
    } else {
      warnInfo('进入好友森林失败')
    }
  }
  taskLog('流程结束，共复活' + revivedCount + '次')
  // 退出前再收取自己的能量
  enterAntForest()
  collectOwnEnergy()
  sleep(1000)
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

main()
