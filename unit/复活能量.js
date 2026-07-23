/*
 * @Author: Auto-generated for Ant-Forest
 * @Description: 复活能量子脚本
 * 复活好友能量，每次获得5g
 *
 * 流程：
 * 大循环最多9次，复活6次或找不到+5g时退出：
 *   1. 进入蚂蚁森林 → 收取自己能量
 *   2. 进入总能量榜（完整排行榜）
 *   3. findColor查找+5g（橙色按钮#FF8F00），连续2次没找到下滑30%，最多10次
 *      找到后取第一个，进入好友森林复活
 *   4. 回到步骤1
 *
 * 控件查找：使用WidgetInspector.detectAllNodes遍历所有控件匹配文本
 * +5g查找：findColor颜色匹配
 * 帮TA复活能量：OCR模糊匹配"复活/能量/立得"，限制屏幕上半部
 *
 * 退出前：再收一次能量 → minimize → killApps → removeRunningTask → exit
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

  if (!widgetUtils.homePageWaiting()) {
    errorInfo('进入蚂蚁森林失败')
    return false
  }
  // taskLog('进入蚂蚁森林成功')
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
  if (findAndClickByTextVisible(/总能量榜/)) {
    sleep(1000)
    return true
  }
  let limit = 5
  do {
    let h = config.device_height
    automator.randomScrollDown(h * 0.72, h * 0.73, h * 0.42, h * 0.43)
    if (findAndClickByTextVisible(/总能量榜/)) {
      sleep(1000)
      return true
    }
  } while (--limit > 0)
  warnInfo('切换到总能量榜tab失败')
  return false
}

/**
 * 首次进入总能量榜：点击tab + 下滑进入完整排行榜列表
 */
function enterEnergyRankFirstTime() {
  taskLog('进入总能量榜')

  if (!clickEnergyRankTab()) {
    return false
  }

  // 下滑找到"查看更多好友"并点击进入完整排行榜
  let scrollLimit = 8
  do {
    let h = config.device_height
    automator.randomScrollDown(h * 0.72, h * 0.73, h * 0.42, h * 0.43)
    sleep(500)
    if (findAndClickByTextVisible(/查看更多好友/)) {
      sleep(1000)
      return true
    }
  } while (--scrollLimit > 0)

  warnInfo('未找到"查看更多好友"，可能已在完整排行榜中')
  return true
}

/**
 * 查找"+5g"复活标志
 * 只用控件查找，必须带+号
 */
function findReviveMarkers() {
  // taskLog('查找+5g复活标志')

  let results = []

  // 用findColor找橙色按钮（+5g是橙底白字）
  debugInfo('使用findColor查找橙色按钮')
  try {
    let screen = commonFunction.captureScreen()
    if (screen) {
      // 橙色 #FF8F00 附近，阈值50，只扫描右侧10%宽度区域
      let color = '#FF8F00'
      let threshold = 50
      let w = config.device_width
      let region = [w * 0.9, 0, w * 0.1, config.device_height]
      let maxFind = 20
      while (maxFind-- > 0) {
        let point = images.findColor(screen, color, {
          region: region,
          threshold: threshold
        })
        if (!point) break

        // 计算按钮中心（按钮约30px高，取点+15px为中心）
        let centerY = point.y + 15
        let centerX = point.x + 20  // 按钮宽约35px

        debugInfo(['findColor找到橙色点: ({}, {})', point.x, point.y])
        results.push({
          text: '+5g',
          centerX: centerX,
          centerY: centerY
        })

        // 排除这个点附近区域，继续找下一个
        region = [w * 0.9, point.y + 30, w * 0.1, config.device_height - (point.y + 30)]
        if (region[3] <= 0) break
      }
    }
  } catch (e) {
    warnInfo('findColor异常: ' + e)
  }

  // 去重（按y坐标去重，同一按钮上下边缘各有一个点）
  let uniqueResults = []
  results.forEach(r => {
    let isDuplicate = uniqueResults.some(u =>
      Math.abs(u.centerY - r.centerY) < 40
    )
    if (!isDuplicate) {
      uniqueResults.push(r)
    }
  })

  // taskLog('找到 ' + uniqueResults.length + ' 个+5g标志')
  return uniqueResults
}

/**
 * 只查找第一个+5g标志，找到即返回，不遍历全部
 * @returns {Object|null} marker对象或null
 */
/**
 * 点击5g标志进入好友森林
 */
function clickAndEnterFriendForest(marker) {
  taskLog('点击5g标志进入好友森林，位置: (' + marker.centerX + ', ' + marker.centerY + ')')

  // 点击5g标志的位置
  automator.click(marker.centerX, marker.centerY)

  // 等待页面加载，用OCR检查是否进入好友森林
  if (localOcrUtil.enabled) {
    let waitCount = 5
    while (waitCount-- > 0) {
      sleep(1000)
      let screen = commonFunction.captureScreen()
      if (screen) {
        let ocrResult = localOcrUtil.recognizeWithBounds(screen)
        screen.recycle()
        if (ocrResult) {
          let found = ocrResult.some(item => /复活|能量|立得/.test(item.text || item.label || ''))
          if (found) {
            debugInfo('OCR确认进入好友森林')
            return true
          }
        }
      }
    }
  }

  warnInfo('可能未进入好友森林，尝试返回')
  goBack()
  sleep(1000)
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

  if (config.not_collect_self) {
    debugInfo('配置为不收取自己能量，跳过')
    return
  }

  // 确保在首页
  if (!widgetUtils.homePageWaiting()) {
    warnInfo('不在首页，尝试返回')
    goBack()
    sleep(1000)
    if (!widgetUtils.homePageWaiting()) {
      warnInfo('返回首页失败，尝试重新进入')
      enterAntForest()
    }
  }

  // 使用 BaseScanner 收取能量
  // Yolo 不可用时自动降级为霍夫变换找圆（checkAndCollectByHough）
  let ReviveBaseScanner = require('../core/BaseScanner.js')
  let scanner = new ReviveBaseScanner()
  scanner.collectEnergy(true)

  // taskLog('收取自己能量完成')
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

  let find = true
  let revivedCount = 0

  for (let i = 1; i <= 9 && revivedCount < 6 && find; i++) {
    taskLog('第' + i + '轮（已复活' + revivedCount + '次）')

    // 步骤1: 进入蚂蚁森林并收取自己的能量
    if (!enterAntForest()) {
      errorInfo('进入蚂蚁森林失败，结束脚本')
      break
    }
    sleep(1000)
    collectOwnEnergy()

    // 步骤2: 进入总能量榜
    enterEnergyRankFirstTime()

    // 步骤3: 查找+5g，连续2次没有下滑30%，最多10次
    let markers = []
    let noFoundCount = 0
    let scrollCount = 0
    while (markers.length === 0 && scrollCount < 10) {
      markers = findReviveMarkers()
      if (markers.length > 0) {
        noFoundCount = 0
        break
      }
      noFoundCount++
      if (noFoundCount >= 2) {
        let h = config.device_height
        automator.randomScrollDown(h * 0.72, h * 0.73, h * 0.42, h * 0.43)
        sleep(600)
        scrollCount++
        noFoundCount = 0
      } else {
        sleep(200)
      }
    }

    if (markers.length === 0) {
      warnInfo('未找到+5g，结束脚本')
      find = false
      break
    }

    // 取第一个+5g进入好友森林复活
    if (clickAndEnterFriendForest(markers[0])) {
      sleep(1000)
      if (clickReviveEnergy()) {
        if (clickConfirmSend()) {
          revivedCount++
          taskLog('成功复活，累计' + revivedCount + '次')
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
  sleep(1000)
  collectOwnEnergy()
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

main()
