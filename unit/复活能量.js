/*
 * @Author: Auto-generated for Ant-Forest
 * @Description: 复活能量子脚本
 * 每天8:00-22:00运行，复活好友能量，每次获得5g
 * 大循环2次，每次内小循环7次
 * 
 * 流程：
 * 大循环2次：
 *   1. 进入蚂蚁森林
 *   2. 点击总能量榜tab → 下滑找"查看更多好友" → 进入完整排行榜
 *   3. 小循环（最多7次）：
 *      a. 控件查找+5g，连续2次没有就下滑30%，最多10次
 *      b. 遍历当前屏幕所有+5g，逐个进入好友森林复活
 *      c. 复活6次后跳过剩余小循环
 *      d. 返回总榜继续
 *   4. 重新进入自己森林 → 收取自己能量
 * 退出：minimize → killApps → removeRunningTask → exit
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

// ============ 核心功能 ============

/**
 * 检查时间是否在8:00-22:00之间
 */
function checkTimeRange() {
  let now = new Date()
  let hour = now.getHours()
  if (hour < 8 || hour >= 22) {
    taskLog('当前时间不在8:00-22:00范围内，跳过复活能量操作')
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
  taskLog('进入蚂蚁森林成功')
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
  let rankTab = widgetUtils.widgetGetOne('.*(今日|本周|总)能量榜.*', 2000)
  if (rankTab) {
    debugInfo(['通过文案找到能量榜按钮: {}', rankTab.text()])
    rankTab.click()
    sleep(1000)
    return true
  }
  let limit = 5
  do {
    let h = config.device_height
    automator.randomScrollDown(h * 0.72, h * 0.73, h * 0.42, h * 0.43)
    rankTab = widgetUtils.widgetGetOne('.*(今日|本周|总)能量榜.*', 1000)
    if (rankTab) {
      rankTab.click()
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
  taskLog('首次进入总能量榜')

  if (!clickEnergyRankTab()) {
    return false
  }

  // 下滑找到"查看更多好友"并点击进入完整排行榜
  let moreFriends = null
  let scrollLimit = 8
  do {
    let h = config.device_height
    automator.randomScrollDown(h * 0.72, h * 0.73, h * 0.42, h * 0.43)
    sleep(500)
    moreFriends = widgetUtils.widgetGetOne(config.enter_friend_list_ui_content || '.*查看更多好友.*', 1000)
    if (moreFriends) {
      moreFriends.click()
      sleep(1000)
      taskLog('进入完整排行榜')
      return true
    }
    if (localOcrUtil.enabled) {
      let screen = commonFunction.captureScreen()
      if (screen) {
        let ocrResult = localOcrUtil.recognizeWithBounds(screen, null, '查看更多好友')
        screen.recycle()
        if (ocrResult && ocrResult.length > 0) {
          let target = ocrResult[0]
          let bd = target.bounds
          automator.click(bd.centerX(), bd.centerY())
          sleep(1000)
          taskLog('OCR找到"查看更多好友"并点击')
          return true
        }
      }
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
  taskLog('查找+5g复活标志')

  let results = []

  debugInfo('使用控件查找+5g标志')
  let widgets = widgetUtils.widgetGetAll('[+＋]5g', 2000, true, null, { algorithm: 'PDFS' })
  if (widgets && widgets.target) {
    let isDesc = widgets.isDesc
    widgets.target.forEach(w => {
      let text = isDesc ? w.desc() : w.text()
      text = text || ''
      if (/[+＋]5g/i.test(text)) {
        let bd = w.bounds()
        debugInfo(['控件找到+5g: {} 位置: {}', text, JSON.stringify(bd)])
        results.push({
          text: text,
          bounds: bd,
          centerX: Math.round(bd.centerX()),
          centerY: Math.round(bd.centerY())
        })
      }
    })
  }

  // 去重
  let uniqueResults = []
  results.forEach(r => {
    let isDuplicate = uniqueResults.some(u =>
      Math.abs(u.centerX - r.centerX) < 50 && Math.abs(u.centerY - r.centerY) < 50
    )
    if (!isDuplicate) {
      uniqueResults.push(r)
    }
  })

  taskLog('找到 ' + uniqueResults.length + ' 个+5g标志')
  return uniqueResults
}

/**
 * 点击5g标志进入好友森林
 */
function clickAndEnterFriendForest(marker) {
  taskLog('点击5g标志进入好友森林，位置: (' + marker.centerX + ', ' + marker.centerY + ')')

  // 点击5g标志的位置
  automator.click(marker.centerX, marker.centerY)
  sleep(2000)

  // 检查是否进入了好友的蚂蚁森林
  let hasReviveBtn = widgetUtils.widgetGetOne('帮TA复活能量|帮好友复活能量', 2000)
  if (hasReviveBtn) {
    debugInfo('成功进入好友森林，找到"帮TA复活能量"')
    return true
  }

  // 尝试OCR识别"帮TA复活能量"
  if (localOcrUtil.enabled) {
    let screen = commonFunction.captureScreen()
    if (screen) {
      let ocrResult = localOcrUtil.recognizeWithBounds(screen)
      screen.recycle()
      if (ocrResult) {
        let found = ocrResult.some(item => /帮TA复活能量|帮好友复活能量/.test(item.text || item.label || ''))
        if (found) {
          debugInfo('OCR确认进入好友森林')
          return true
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
  taskLog('查找"帮TA复活能量"')

  // 方法1: 控件查找
  let reviveBtn = widgetUtils.widgetGetOne('帮TA复活能量|帮好友复活能量', 2000)
  if (reviveBtn) {
    debugInfo('找到"帮TA复活能量"按钮')
    automator.clickCenter(reviveBtn)
    sleep(1500)
    return true
  }

  // 方法2: OCR识别
  if (localOcrUtil.enabled) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let ocrResult = localOcrUtil.recognizeWithBounds(screen)
      screen.recycle()
      if (ocrResult) {
        for (let item of ocrResult) {
          let text = item.text || item.label || ''
          if (/帮TA复活能量|帮好友复活能量/.test(text)) {
            let bd = item.bounds
            let cx = Math.round((bd.left + bd.right) / 2)
            let cy = Math.round((bd.top + bd.bottom) / 2)
            debugInfo(['OCR找到"帮TA复活能量" 位置: ({}, {})', cx, cy])
            automator.click(cx, cy)
            sleep(1500)
            return true
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
  taskLog('查找"确认发送"按钮')

  // 方法1: 控件查找
  let confirmBtn = widgetUtils.widgetGetOne('确认发送', 2000)
  if (confirmBtn) {
    debugInfo('找到"确认发送"按钮')
    automator.clickCenter(confirmBtn)
    sleep(1000)
    return true
  }

  // 方法2: OCR识别
  if (localOcrUtil.enabled) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let ocrResult = localOcrUtil.recognizeWithBounds(screen)
      screen.recycle()
      if (ocrResult) {
        for (let item of ocrResult) {
          let text = item.text || item.label || ''
          if (/确认发送/.test(text)) {
            let bd = item.bounds
            let cx = Math.round((bd.left + bd.right) / 2)
            let cy = Math.round((bd.top + bd.bottom) / 2)
            debugInfo(['OCR找到"确认发送" 位置: ({}, {})', cx, cy])
            automator.click(cx, cy)
            sleep(1000)
            return true
          }
        }
      }
    }
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

  taskLog('收取自己能量完成')
}

// ============ 主流程 ============

function main() {
  infoLog('复活能量脚本启动', true)

  // if (!checkTimeRange()) {
  //   commonFunction.minimize()
  //   sleep(500)
  //   // 杀掉后台进程
  //   killApps()
  //   sleep(500)
  //   runningQueueDispatcher.removeRunningTask()
  //   exit()
  // }

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

  // 大循环2次
  for (let bigLoop = 1; bigLoop <= 2; bigLoop++) {
    taskLog('====== 第' + bigLoop + '次大循环 ======')

    // 步骤1: 进入蚂蚁森林
    taskLog('=== 步骤1: 进入蚂蚁森林 ===')
    if (!enterAntForest()) {
      errorInfo('进入蚂蚁森林失败，跳过本轮')
      continue
    }

    // 步骤2: 首次进入总能量榜（点击tab + 下滑进完整列表）
    taskLog('=== 步骤2: 进入总能量榜 ===')
    enterEnergyRankFirstTime()

    // 小循环7次：查找并复活能量
    let revivedCount = 0
    
    for (let smallLoop = 1; smallLoop <= 7; smallLoop++) {
      taskLog('=== 第' + smallLoop + '次小循环（第' + (revivedCount + 1) + '次复活） ===')

      // 步骤3: 查找+5g标志
      // 查找+5g，连续2次没有就下滑1次，最多下滑10次
      taskLog('步骤3: 查找+5g标志')
      let markers = []
      let noFoundCount = 0  // 连续没找到的次数
      let scrollCount = 0   // 下滑次数
      while (markers.length === 0 && scrollCount < 10) {
        markers = findReviveMarkers()
        if (markers.length > 0) {
          noFoundCount = 0
          break
        }
        noFoundCount++
        if (noFoundCount >= 2) {
          // 连续2次没找到，下滑一次
          let h = config.device_height
          automator.randomScrollDown(h * 0.72, h * 0.73, h * 0.42, h * 0.43)
          sleep(600)
          scrollCount++
          noFoundCount = 0  // 重置连续计数
        } else {
          sleep(200)
        }
      }

      if (markers.length === 0) {
        warnInfo('未找到+5g标志，结束本轮小循环')
        break
      }

      // 遍历当前屏幕所有+5g标志，逐个复活
      let reviveSuccess = false
      for (let mi = 0; mi < markers.length && revivedCount < 6; mi++) {
        let marker = markers[mi]

        // 步骤4: 点击进入好友森林
        taskLog('步骤4: 点击进入好友森林，第' + (mi + 1) + '/' + markers.length + '个')
        if (!clickAndEnterFriendForest(marker)) {
          warnInfo('进入好友森林失败，尝试下一个')
          continue
        }

        sleep(1000)

        // 步骤5: 查找并点击"帮TA复活能量"
        taskLog('步骤5: 查找"帮TA复活能量"')
        if (!clickReviveEnergy()) {
          warnInfo('未找到"帮TA复活能量"，返回继续')
          goBack()
          sleep(1000)
          continue
        }

        // 步骤6: 点击"确认发送"
        taskLog('步骤6: 点击"确认发送"')
        if (clickConfirmSend()) {
          revivedCount++
          reviveSuccess = true
          taskLog('成功复活能量，累计复活 ' + revivedCount + ' 次')
          // 复活6次后直接跳到步骤7
          if (revivedCount >= 6) {
            taskLog('已复活6次，跳过剩余小循环')
            break
          }
        } else {
          warnInfo('确认发送失败')
        }

        // 返回总榜（从好友森林返回一次直接回到完整总榜）
        taskLog('返回总榜')
        goBack()
        sleep(1000)
      }

      if (revivedCount >= 6) {
        break
      }
    }

    taskLog('第' + bigLoop + '次大循环完成，共复活 ' + revivedCount + ' 次')

    // 步骤7: 回到自己的蚂蚁森林，收取自己的能量
    taskLog('步骤7: 重新进入蚂蚁森林收取能量')
    enterAntForest()
    sleep(1000)
    collectOwnEnergy()
  }

  taskLog('====== 复活能量流程结束 ======')
  commonFunction.minimize()
  sleep(500)
  // 杀掉后台进程
  killApps()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

main()
