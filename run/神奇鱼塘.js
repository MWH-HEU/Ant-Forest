/*
 * 神奇鱼塘任务脚本
 * 功能：
 * 1. 打开闲鱼主Activity，通过控件点击"神奇鱼塘"进入，并处理"领取并投喂"弹窗
 * 2. 收取自己的能量
 * 3. 点击"得能量"进入任务页面（优先模板匹配get_energy_icon，OCR兜底）
 * 4. 通过控件循环查找并完成3个任务：
 *    - 浏览商品：进入商品列表后下滑查找"抵后价"并点击
 *    - 绿色答题：依次点击A.选项→提交答案→立即收能量
 *    - 去蚂蚁森林：进入后等待3秒返回，杀掉支付宝进程
 * 5. 每完成一个任务后重进鱼塘→收能量→点得能量→等任务页面，直至3个任务全部完成
 * 6. 所有任务完成后再次收能量，杀掉进程退出
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
let FloatyInstance = sRequire('FloatyUtil')
let LogFloaty = sRequire('LogFloaty')
let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
let killProcessUtil = require('../lib/KillProcessUtil.js')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let widgetInspector = require('../lib/WidgetInspector.js')(runtime, global)
let OpenCvUtil = require('../lib/OpenCvUtil.js')
let FileUtils = require('../lib/prototype/FileUtils.js')

function killApps () {
  try {
    killProcessUtil.killMultiple([
      { pkg: config.package_name || 'com.eg.android.AlipayGphone', name: '支付宝' },
      { pkg: 'com.taobao.idlefish', name: '闲鱼' }
    ], function(name, success) {
      taskLog(name + ' → ' + (success ? '✓ 已杀掉' : '✗ 失败'))
    })
  } catch (e) {
    taskLog('kill进程失败: ' + e)
  }
}
function killAlipayGphone () {
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

/**
 * 退出脚本：最小化、杀掉后台进程、移除运行中任务并退出
 */
function exitScript () {
  commonFunction.minimize()
  sleep(500)
  killApps()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
  exit()
}

runningQueueDispatcher.addRunningTask()

// 日志文件（writeLog 为预留调试功能，当前 taskLog 未启用文件写入）
let _logFile = null
let _logFilePath = FileUtils.getRealMainScriptPath(true) + '/logs/yutang.log'
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

// 调试日志（仅悬浮窗显示）
function taskLog (msg) {
  LogFloaty.pushLog(msg)
  // writeLog(msg)
}

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

/**
 * 返回上一页
 */
function goBack () {
  back()
  sleep(2000)
}

/**
 * 通过控件查找可见区域内的文字并点击
 * @param {RegExp} pattern - 匹配文字的正则表达式
 * @returns {boolean} 是否找到并点击
 */
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

/**
 * 查找任务并执行：两遍遍历，先记录描述文字的y值，再匹配按钮文字做同行判断
 * @param {string} descText - 任务描述文字（如"点击1个商品进入详情页"）
 * @param {string} btnText - 按钮文字（如"去浏览"）
 * @param {function} taskFn - 执行任务的函数
 * @returns {boolean} 是否找到并执行了任务
 */
function findAndExecuteTask (descText, btnText, taskFn) {
  let allNodes = widgetInspector.detectAllNodesVisible().nodes
  if (!allNodes || allNodes.length === 0) return false

  // 第一遍：记录描述文字的y值
  let descY = -1
  for (let i = 0; i < allNodes.length; i++) {
    let text = allNodes[i].text
    if (text.indexOf(descText) >= 0) {
      descY = allNodes[i].bounds.centerY()
      // taskLog('找到任务: "' + descText + '"')
      break
    }
  }
  if (descY < 0) {
    taskLog('未找到任务: "' + descText + '"')
    return false
  }

  // 第二遍：匹配按钮文字，同行判断
  for (let i = 0; i < allNodes.length; i++) {
    let node = allNodes[i]
    if (node.text === btnText) {
      let y = node.bounds.centerY()
      if (Math.abs(y - descY) < 200) {
        taskLog('找到任务: "' + descText + '"，对应按钮: ' + btnText)
        automator.click(node.bounds.centerX(), node.bounds.centerY())
        sleep(2000)
        taskFn()
        return true
      }
    }
  }
  taskLog('找到任务: "' + descText + '"，未找到对应按钮: ' + btnText + '，任务可能已完成')
  return false
}
// ============ 神奇鱼塘操作 ============

/**
 * 打开闲鱼神奇鱼塘（旧版，通过intent直达）
 * 注意：当前主流程未使用，保留备用
 */
function openFishPoolByIntent () {
  taskLog("准备打开闲鱼神奇鱼塘（intent方式）")

  commonFunction.backHomeIfInVideoPackage()

  app.startActivity({
    action: "VIEW",
    data: "https://pages.goofish.com/sharexy?url=https%3A%2F%2Fssr.m.goofish.com%2Fwow%2Fmoyu%2Fmoyu-project%2Ffish-pool%2Fpages%2Fhome%3Fx-ssr%3Dtrue%26_from__%3Dmain%26x-cur%3DCNY%26x-lang%3Dzh-CN%26x-tz%3DAsia%252FShanghai%26x-cs%3DCN",
      packageName: "com.taobao.idlefish"
  })
  let confirm = widgetUtils.widgetGetOne(/^打开$/, 2000)
  if (confirm) {
    automator.clickCenter(confirm)
  }

  return waitForFishPoolPage()
}

/**
 * 打开闲鱼神奇鱼塘：打开闲鱼主Activity，再通过控件点击"神奇鱼塘"进入，
 * 进入后处理"领取并投喂"弹窗，最后等待鱼塘页面加载
 */
function openFishPool () {
  taskLog("准备打开闲鱼神奇鱼塘")

  commonFunction.backHomeIfInVideoPackage()

  // 打开闲鱼主Activity
  app.startActivity({
    action: "android.intent.action.MAIN",
    packageName: "com.taobao.idlefish",
    className: "com.taobao.idlefish.maincontainer.activity.MainActivity"
  })
  sleep(3000)

  // 等待"神奇鱼塘"入口出现
  widgetUtils.widgetWaiting('神奇鱼塘', '神奇鱼塘入口', 5000)

  // 通过控件点击"神奇鱼塘"进入
  findAndClickByTextVisible(/神奇鱼塘/)
  sleep(2000)

  // 进入鱼塘后处理"领取并投喂"弹窗（原步骤2已移入此处）
  handleFeedDialog()

  return waitForFishPoolPage()
}

/**
 * 等待神奇鱼塘页面加载
 */
function waitForFishPoolPage () {
  taskLog("等待神奇鱼塘页面加载")
  sleep(3000)
  let checkResult = widgetUtils.widgetWaiting(".*(神奇鱼塘|得能量|鱼塘绿色度|投喂).*", "神奇鱼塘页面", 5000)
  if (checkResult) {
    taskLog("神奇鱼塘页面已加载")
    return true
  }
  taskLog("神奇鱼塘页面加载超时")
  return false
}

/**
 * 收取自己的能量
 */
function collectOwnEnergy () {
  taskLog('收取自己的能量')

  // 使用 BaseScanner 收取能量
  let ReviveBaseScanner = require('../core/BaseScanner.js')
  let scanner = new ReviveBaseScanner()
  scanner.collectEnergy(true)
}

/**
 * 处理"领取并投喂"弹窗：通过控件查找"领取并投喂"并点击领取投喂，
 * 点击后返回上一页，再点击"神奇鱼塘"重新进入
 */
function handleFeedDialog () {
  taskLog('处理"领取并投喂"弹窗')

  // 等待"领取并投喂"弹窗出现
  widgetUtils.widgetWaiting('领取并投喂', '领取并投喂弹窗', 2000)

  if (findAndClickByTextVisible(/领取并投喂/)) {
    taskLog('已点击"领取并投喂"，返回上一页')
    sleep(1000)
    goBack()
    sleep(1000)
    findAndClickByTextVisible(/神奇鱼塘/)
    return true
  }

  taskLog('未检测到"领取并投喂"')
  return false
}

/**
 * 点击"得能量"进入任务页面
 * 优先使用模板图片匹配（get_energy_icon），模板未配置或匹配失败时回退到OCR识别
 * @returns {boolean} 是否成功点击了"得能量"
 */
function clickGetEnergy () {
  taskLog('点击"得能量"')
  sleep(2000)

  // 方案1：模板图片匹配（优先）
  if (config.image_config && config.image_config.get_energy_icon) {
    try {
      let screen = commonFunction.captureScreen()
      if (screen) {
        let match = OpenCvUtil.findByGrayBase64(screen, config.image_config.get_energy_icon, false)
        if (match) {
          let centerX = Math.round(match.centerX())
          let centerY = Math.round(match.centerY())
          taskLog('模板匹配找到"得能量": 点击: (' + centerX + ', ' + centerY + ')')
          automator.click(centerX, centerY)
          sleep(2000)
          return true
        }
        taskLog('模板匹配未找到"得能量"，回退到OCR')
      } else {
        taskLog('截屏失败，回退到OCR')
      }
    } catch (e) {
      taskLog('模板匹配异常: ' + e + '，回退到OCR')
    }
  } else {
    taskLog('未配置get_energy_icon模板，使用OCR')
  }

  // 方案2：OCR识别（兜底）
  taskLog('通过OCR识别"得能量"')
  let ocrResult = widgetInspector.detectByOcr()

  for (let item of ocrResult.results) {
    if (item.label.indexOf('得能量') >= 0) {
      let bounds = item.bounds
      taskLog('OCR找到"得能量": 点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
      automator.click(bounds.centerX(), bounds.centerY())
      sleep(2000)
      return true
    }
  }

  taskLog('未找到"得能量"入口')
  return false
}

/**
 * 等待任务页面加载（检测任务描述文字：每天提醒我收绿色打卡能量 / 点击1个商品进入详情页 / 参与绿色科普答题 / 去蚂蚁森林收更多能量）
 */
function waitForTaskPage () {
  taskLog('等待任务页面加载')
  let checkResult = widgetUtils.widgetWaiting('.*(每天提醒我收绿色打卡能量|点击1个商品进入详情页|参与绿色科普答题|去蚂蚁森林收更多能量).*', '任务页面', 5000)
  if (checkResult) {
    taskLog('任务页面已加载')
    sleep(1000)
    return true
  }
  taskLog('任务页面加载超时')
  return false
}

/**
 * 检查并关闭"领取并投喂"浮层
 * 先找"领取并投喂"按钮，再在其正下方找X按钮（宽高比接近1:1的正方形）
 * 注意：当前主流程未使用（弹窗由 handleFeedDialog 直接点击领取），保留备用
 */
function checkDialogAndClose () {
  taskLog('检查是否存在"领取并投喂"弹窗')
  try {
    let result = widgetInspector.detectAllNodesVisible()
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

    taskLog('找到"领取并投喂"，查找其正下方关闭按钮')

    for (let node of result.nodes) {
      let bd = node.bounds
      if (!bd) continue
      let rate = bd.width() / bd.height()
      if (rate < 0.8 || rate > 1.2) continue
      if (Math.abs(bd.centerX() - feedBounds.centerX()) > 50) continue
      if (bd.top < feedBounds.bottom + 50) continue
      if (bd.top > feedBounds.bottom + 400) continue
      taskLog('找到关闭按钮，点击关闭')
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

/**
 * 执行浏览商品任务：进入商品列表后下滑查找"抵"（完全匹配）或"抵后价..."商品并点击
 */
function doBrowseTask () {
  taskLog('执行浏览商品任务')

  // 等待商品列表页面加载
  sleep(2000)

  let maxScroll = 3
  for (let s = 0; s < maxScroll; s++) {
    taskLog('浏览商品 第' + (s + 1) + '次下滑')

    let h = config.device_height
    // 从65%-75%高度开始，随机下滑15%-25%，延时100+Math.random()*300
    let startY = h * (0.65 + Math.random() * 0.10)
    let endY = startY - h * (0.15 + Math.random() * 0.10)
    let duration = 100 + Math.random() * 300
    automator.gestureDown(startY, endY, duration)
    sleep(3000)

    // 优先匹配"抵"（完全匹配），其次匹配"抵后价..."
    let clickBtn = widgetUtils.widgetGetOne('^抵$|抵后价.*')
    if (clickBtn) {
      taskLog('找到商品，点击')
      clickBtn.click()
      sleep(3000)
      taskLog('已点击商品，等待详情页加载后返回')
      goBack()
      sleep(500)
      goBack()
      sleep(500)
      return true
    }

    taskLog('未找到商品，继续下滑')
  }

  taskLog('浏览任务失败：未找到商品')
  return false
}

/**
 * 执行答题任务：依次点击"A." "提交答案" "立即收能量"
 */
function doQuizTask () {
  taskLog('执行答题任务')

  taskLog('等待答题弹窗加载')
  widgetUtils.widgetWaiting('.*(绿色答题|提交答案).*', '答题弹窗', 1000)
  sleep(1000)

  // 点击第一个选项 A.
  taskLog('选择第一个选项')
  if (!findAndClickByTextVisible(/^A\./)) {
    taskLog('答题失败：未找到A.选项')
    return false
  }
  sleep(500)

  // 点击提交答案
  taskLog('点击"提交答案"')
  findAndClickByTextVisible(/提交答案/)
  sleep(500)

  // 等待提交完成，再点击立即收能量
  taskLog('等待提交结果')
  sleep(500)

  // 点击立即收能量
  taskLog('点击"立即收能量"')
  findAndClickByTextVisible(/立即收能量/)
  sleep(500)

  return true
}

/**
 * 执行蚂蚁森林任务：等待进入蚂蚁森林，停留3秒后杀掉支付宝进程返回
 */
function doAntForestTask () {
  taskLog('执行蚂蚁森林任务')

  taskLog('等待进入蚂蚁森林')
  let entered = widgetUtils.widgetWaiting('.*(蚂蚁森林|森林|收集能量|浇水|去保护|找能量|森林广场).*', '蚂蚁森林页面', 5000)
  if (!entered) {
    taskLog('未检测到蚂蚁森林页面，直接返回')
    return false
  }
  taskLog('已在蚂蚁森林，等待3s后返回')
  sleep(3000)

  taskLog('杀掉支付宝进程')
  killAlipayGphone()
  sleep(1000)

  return true
}

/**
 * 依次尝试三个任务（浏览商品 / 绿色答题 / 去蚂蚁森林），找到并执行一个即返回
 * @returns {boolean} 是否执行了某个任务
 */
function findAndExecuteTasks () {
  taskLog('通过控件查找任务按钮')

  // 依次尝试三个任务
  if (findAndExecuteTask('点击1个商品进入详情页', '去浏览', doBrowseTask)) return true
  if (findAndExecuteTask('参与绿色科普答题', '去完成', doQuizTask)) return true
  if (findAndExecuteTask('去蚂蚁森林收更多能量', '去完成', doAntForestTask)) return true

  taskLog('未找到可执行的任务按钮')
  return false
}

/**
 * 执行鱼塘主页面任务：两遍遍历，先找目标文字记录x坐标，再找同列数字+g格式控件
 * 注意：当前主流程未使用，保留备用
 */
function doMainPageTasks () {
  taskLog('执行鱼塘主页面任务')

  let allNodes = widgetInspector.detectAllNodesVisible().nodes
  if (!allNodes || allNodes.length === 0) return

  let targets = [/森林回访/, /线上逛街/, /闲置交易/, /绿色科普/]

  for (let t = 0; t < targets.length; t++) {
    let pattern = targets[t]

    // 第一遍：找目标文字，记录x坐标
    let targetX = -1
    for (let node of allNodes) {
      if (pattern.test(node.text)) {
        targetX = node.bounds.centerX()
        taskLog('找到"' + node.text + '"，x=' + targetX)
        break
      }
    }
    if (targetX < 0) {
      taskLog('未找到"' + pattern + '"')
      continue
    }

    // 第二遍：找同列的数字+g格式控件
    let clicked = false
    for (let node of allNodes) {
      let text = node.text
      if (!text) continue
      if (/^\d+g$/.test(text)) {
        let x = node.bounds.centerX()
        if (Math.abs(x - targetX) < 50) {
          taskLog('找到同列"' + text + '"，点击: (' + node.bounds.centerX() + ', ' + node.bounds.centerY() + ')')
          automator.click(node.bounds.centerX(), node.bounds.centerY())
          sleep(500)
          clicked = true
          break
        }
      }
    }

    if (!clicked) {
      taskLog('未找到"' + pattern + '"同列的数字+g控件')
    }
  }
}



// ============ 主流程 ============

function main () {
  infoLog('神奇鱼塘脚本启动', true)

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

  taskLog('=== 步骤1: 打开神奇鱼塘 ===')
  if (!openFishPool()) {
    errorInfo('打开神奇鱼塘失败')
    exitScript()
  }

  taskLog('=== 步骤2: 先收一次能量 ===')
  collectOwnEnergy()

  taskLog('=== 步骤3: 点击"得能量" ===')
  if (!clickGetEnergy()) {
    errorInfo('无法找到"得能量"入口')
    exitScript()
  }

  taskLog('=== 步骤4: 等待任务页面 ===')
  if (!waitForTaskPage()) {
    errorInfo('任务页面加载失败')
    exitScript()
  }

  taskLog('=== 步骤5: 执行任务 ===')
  for (let round = 0; round < 10; round++) {
    taskLog('第 ' + (round + 1) + ' 轮执行')
    let tasksDone = 0
    while (findAndExecuteTasks()) {
      tasksDone++
      // 执行完每个任务后：重进鱼塘→收能量→点得能量→等任务页面
      openFishPool()
      sleep(2000)
      collectOwnEnergy()
      sleep(1000)
      clickGetEnergy()
      sleep(2000)
      waitForTaskPage()
    }
    taskLog('本轮完成 ' + tasksDone + ' 个任务')
    if (tasksDone === 0) {
      taskLog('三个任务都找不到，视为已完成，退出')
      break
    }
    sleep(1000)
  }

  taskLog('所有任务执行完毕')
  // 重新进入鱼塘，收取能量后杀掉进程
  openFishPool()
  sleep(2000)
  collectOwnEnergy()
  sleep(1000)
  exitScript()
}

main()
