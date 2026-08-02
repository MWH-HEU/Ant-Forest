/*
 * @Description: 测试限时道具兑换页面检测
 * 进入蚂蚁森林背包页面和活力值兑换页面，识别所有控件和OCR文字，
 * 记录所有TextView/Button/可点击节点的XY值和文字内容到日志文件。
 * 采用森林寻宝测试脚本中的方法（方法1/2/3，排除方法4颜色识别）。
 */
let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let args = config.parseExecArgv()
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
singletonRequire = sRequire
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let LogFloaty = sRequire('LogFloaty')
let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let killProcessUtil = require('../lib/KillProcessUtil.js')
let FileUtils = sRequire('FileUtils')

runningQueueDispatcher.addRunningTask()

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}
config.show_debug_log = true
commonFunction.autoSetUpBangOffset(true)

// ============ 文件日志 ============
let _logFile = null
let _logFilePath = FileUtils.getRealMainScriptPath(true) + '/logs/测试限时道具兑换.log'
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

function goBack() {
  back()
  sleep(800)
}

// 获取控件文本（安全）
function getNodeText (node) {
  try {
    if (node.text) {
      let t = node.text()
      if (t) return t.toString()
    }
    if (node.desc) {
      let d = node.desc()
      if (d) return d.toString()
    }
    if (node.contentDescription) {
      let c = node.contentDescription()
      if (c) return c.toString()
    }
  } catch (e) {}
  return ''
}

// ============ 检测方法 ============

// 方法1: 控件查找Button + TextView
function detectByWidget () {
  taskLog('')
  taskLog('>>> 方法1: 控件查找Button + TextView')
  
  // Button
  try {
    let allNodes = className('android.widget.Button').find()
    if (allNodes) {
      taskLog('找到 ' + allNodes.size() + ' 个Button控件')
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let text = getNodeText(node)
          let bounds = node.bounds()
          taskLog('  Button[' + i + ']: text="' + text + '" bounds=(' + bounds.left + ',' + bounds.top + ',' + bounds.right + ',' + bounds.bottom + ') center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
        } catch (e) {
          taskLog('  Button[' + i + '] 异常: ' + e)
        }
      }
    } else {
      taskLog('  未找到Button控件')
    }
  } catch (e) {
    taskLog('  控件查找Button异常: ' + e)
  }
  
  // TextView
  try {
    let allNodes = className('android.widget.TextView').find()
    if (allNodes) {
      taskLog('找到 ' + allNodes.size() + ' 个TextView控件')
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let text = getNodeText(node)
          let bounds = node.bounds()
          taskLog('  TextView[' + i + ']: text="' + text + '" bounds=(' + bounds.left + ',' + bounds.top + ',' + bounds.right + ',' + bounds.bottom + ') center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
        } catch (e) {
          taskLog('  TextView[' + i + '] 异常: ' + e)
        }
      }
    } else {
      taskLog('  未找到TextView控件')
    }
  } catch (e) {
    taskLog('  控件查找TextView异常: ' + e)
  }
}

// 方法2: 所有控件检测（含可点击属性、className）
function detectAllNodes () {
  taskLog('')
  taskLog('>>> 方法2: 所有控件检测')
  try {
    let allNodes = selector().find()
    if (allNodes) {
      taskLog('找到 ' + allNodes.size() + ' 个控件')
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let node = allNodes.get(i)
          let text = getNodeText(node)
          let className = node.className()
          let clickable = false
          try { clickable = node.clickable() } catch (e) {}
          let bounds = node.bounds()
          taskLog('  Node[' + i + ']: class=' + className + ' clickable=' + clickable + ' text="' + text + '" center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
        } catch (e) {}
      }
    } else {
      taskLog('  未找到控件')
    }
  } catch (e) {
    taskLog('  控件检测异常: ' + e)
  }
}

// 方法3: OCR识别所有文字
function detectByOcr (sharedScreen) {
  taskLog('')
  taskLog('>>> 方法3: OCR识别所有文字')
  if (!localOcrUtil.enabled) {
    taskLog('  OCR未启用，跳过')
    return null
  }
  let screen = sharedScreen
  let needRecycle = false
  if (!screen) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    screen = commonFunction.captureScreen()
    needRecycle = true
  }
  if (!screen) {
    taskLog('  截图失败')
    return null
  }
  let results = localOcrUtil.recognizeWithBounds(screen, null, null)
  if (needRecycle) {
    screen.recycle()
  }
  if (results && results.length > 0) {
    taskLog('OCR识别到 ' + results.length + ' 个文字区域')
    for (let i = 0; i < results.length; i++) {
      let match = results[i]
      let bounds = match.bounds
      taskLog('  OCR[' + i + ']: text="' + match.label + '" bounds=(' + bounds.left + ',' + bounds.top + ',' + bounds.right + ',' + bounds.bottom + ') center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
    }
  } else {
    taskLog('  OCR未识别到任何文字')
  }
  return screen
}

// ============ 关键元素验证 ============

// 验证关键元素能否被各方法找到
function verifyKeyElements () {
  taskLog('')
  taskLog('========================================')
  taskLog('关键元素验证')
  taskLog('========================================')
  
  // 关键元素列表（按原脚本逻辑）
  let keyElements = [
    { name: '背包', keywords: ['背包'] },
    { name: '道具/伙伴分类', keywords: ['道具', '伙伴'] },
    { name: '用活力值兑换', keywords: ['用活力值兑换', '活力值', '兑换'] },
    { name: '能量雨次卡', keywords: ['能量雨次卡', '能量雨'] },
    { name: '已达上限', keywords: ['已达上限'] },
    { name: '立即兑换', keywords: ['立即兑换'] },
    { name: '确认兑换', keywords: ['确认兑换'] },
    { name: '立即使用', keywords: ['立即使用'] },
    { name: '能量雨机会', keywords: ['能量雨机会', '限时能量雨机会'] },
    { name: '使用', keywords: ['使用'] }
  ]
  
  // 收集控件文本
  let widgetTexts = []
  try {
    let allNodes = className('android.widget.TextView').find()
    if (allNodes) {
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let t = getNodeText(allNodes.get(i))
          if (t) widgetTexts.push(t)
        } catch (e) {}
      }
    }
  } catch (e) {}
  
  // 收集Button文本
  try {
    let allNodes = className('android.widget.Button').find()
    if (allNodes) {
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let t = getNodeText(allNodes.get(i))
          if (t) widgetTexts.push(t)
        } catch (e) {}
      }
    }
  } catch (e) {}
  
  // 去重
  let uniqueTexts = []
  for (let ui = 0; ui < widgetTexts.length; ui++) {
    if (uniqueTexts.indexOf(widgetTexts[ui]) < 0) {
      uniqueTexts.push(widgetTexts[ui])
    }
  }
  taskLog('控件中发现的文字: ' + JSON.stringify(uniqueTexts))
  
  // OCR识别
  commonFunction.requestScreenCaptureOrRestart()
  sleep(500)
  let screen = commonFunction.captureScreen()
  let ocrTexts = []
  if (screen && localOcrUtil.enabled) {
    let results = localOcrUtil.recognizeWithBounds(screen, null, null)
    if (results) {
      ocrTexts = results.map(function(r) { return r.label })
    }
    screen.recycle()
  }
  taskLog('OCR识别的文字: ' + JSON.stringify(ocrTexts))
  
  // 逐项验证
  taskLog('')
  taskLog('--- 关键元素命中情况 ---')
  for (let ei = 0; ei < keyElements.length; ei++) {
    let elem = keyElements[ei]
    let widgetHit = false
    let ocrHit = false
    let widgetMatch = ''
    let ocrMatch = ''
    
    for (let wi = 0; wi < uniqueTexts.length; wi++) {
      for (let ki = 0; ki < elem.keywords.length; ki++) {
        if (uniqueTexts[wi].indexOf(elem.keywords[ki]) >= 0) {
          widgetHit = true
          widgetMatch = uniqueTexts[wi]
          break
        }
      }
      if (widgetHit) break
    }
    
    for (let oi = 0; oi < ocrTexts.length; oi++) {
      for (let ki = 0; ki < elem.keywords.length; ki++) {
        if (ocrTexts[oi].indexOf(elem.keywords[ki]) >= 0) {
          ocrHit = true
          ocrMatch = ocrTexts[oi]
          break
        }
      }
      if (ocrHit) break
    }
    
    let widgetStatus = widgetHit ? '✓ 命中("' + widgetMatch + '")' : '✗ 未命中'
    let ocrStatus = ocrHit ? '✓ 命中("' + ocrMatch + '")' : '✗ 未命中'
    taskLog('  [' + elem.name + '] 控件: ' + widgetStatus + ' | OCR: ' + ocrStatus)
  }
}

// ============ 进入背包页面 ============

function enterBackpackPage () {
  taskLog('')
  taskLog('========================================')
  taskLog('步骤1: 打开蚂蚁森林并进入背包')
  taskLog('========================================')
  
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
  taskLog('蚂蚁森林已打开')
  
  // 点击"背包"
  taskLog('点击"背包"按钮')
  let found = false
  try {
    let allNodes = className('android.widget.TextView').find()
    if (allNodes) {
      for (let i = 0; i < allNodes.size(); i++) {
        try {
          let t = allNodes.get(i).text()
          if (t && t.toString().indexOf('背包') >= 0) {
            let bounds = allNodes.get(i).bounds()
            taskLog('控件找到"背包": center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
            automator.click(bounds.centerX(), bounds.centerY())
            sleep(2000)
            found = true
            break
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    taskLog('控件查找背包异常: ' + e)
  }
  
  if (!found && localOcrUtil.enabled) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let results = localOcrUtil.recognizeWithBounds(screen, null, '背包')
      screen.recycle()
      if (results && results.length > 0) {
        let match = results[0]
        taskLog('OCR找到"背包": center=(' + match.bounds.centerX() + ',' + match.bounds.centerY() + ')')
        automator.click(match.bounds.centerX(), match.bounds.centerY())
        sleep(2000)
        found = true
      }
    }
  }
  
  if (!found) {
    taskLog('未找到"背包"按钮')
    return false
  }
  
  taskLog('已进入背包页面')
  sleep(2000)
  return true
}

// ============ 进入活力值兑换页面 ============

function enterExchangePage () {
  taskLog('')
  taskLog('========================================')
  taskLog('步骤2: 点击"用活力值兑换"')
  taskLog('========================================')
  
  // 原脚本策略：找到"道具"或"伙伴"分类标签，计算偏移量点击下方
  let targetY = -1
  let targetX = -1
  
  // 控件查找"道具"或"伙伴"
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
              taskLog('控件找到"' + text + '"，高度: ' + itemHeight + '，点击位置: (' + targetX + ', ' + targetY + ')')
              break
            }
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    taskLog('控件查找异常: ' + e)
  }
  
  // OCR兜底
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
        taskLog('OCR找到"' + match.label + '"，高度: ' + itemHeight + '，点击位置: (' + targetX + ', ' + targetY + ')')
      }
      screen.recycle()
    }
  }
  
  if (targetY > 0) {
    taskLog('点击坐标: (' + targetX + ', ' + targetY + ')')
    automator.click(targetX, targetY)
    sleep(500)
    sleep(2000)
    taskLog('已进入活力值兑换页面')
    return true
  }
  
  taskLog('未找到"道具"或"伙伴"分类标签，尝试直接查找"用活力值兑换"')
  // 兜底：直接找"用活力值兑换"文字
  if (clickByWidgetOrOcr('用活力值兑换', 3000)) {
    sleep(2000)
    taskLog('已进入活力值兑换页面')
    return true
  }
  
  return false
}

// 综合查找：先控件，后OCR
function clickByWidgetOrOcr (text, timeout) {
  let target = widgetUtils.widgetGetOne(text, timeout || 3000)
  if (target) {
    taskLog('控件找到"' + text + '"，点击')
    automator.clickCenter(target)
    sleep(500)
    return true
  }
  if (localOcrUtil.enabled) {
    let deadline = new Date().getTime() + (timeout || 3000)
    while (new Date().getTime() < deadline) {
      commonFunction.requestScreenCaptureOrRestart()
      sleep(300)
      let screen = commonFunction.captureScreen()
      if (screen) {
        let results = localOcrUtil.recognizeWithBounds(screen, null, text)
        screen.recycle()
        if (results && results.length > 0) {
          let match = results[0]
          taskLog('OCR找到"' + text + '"，点击: (' + match.bounds.centerX() + ', ' + match.bounds.centerY() + ')')
          automator.click(match.bounds.centerX(), match.bounds.centerY())
          sleep(500)
          return true
        }
      }
      sleep(500)
    }
  }
  return false
}

// ============ 分析页面 ============

function analyzePage (pageName) {
  taskLog('')
  taskLog('########################################')
  taskLog('分析页面: ' + pageName)
  taskLog('########################################')
  
  // 方法1: 控件查找Button + TextView
  detectByWidget()
  
  // 方法2: 所有控件检测
  detectAllNodes()
  
  // 方法3: OCR识别（共用截图）
  commonFunction.requestScreenCaptureOrRestart()
  sleep(500)
  let sharedScreen = commonFunction.captureScreen()
  if (sharedScreen) {
    detectByOcr(sharedScreen)
    sharedScreen.recycle()
  } else {
    taskLog('截图失败，跳过OCR')
    detectByOcr()
  }
  
  // 关键元素验证
  verifyKeyElements()
  
  taskLog('')
  taskLog('页面分析完成: ' + pageName)
  taskLog('########################################')
  taskLog('')
}

// ============ 主流程 ============

function main () {
  taskLog('====== 测试限时道具兑换 开始 ======')
  taskLog('设备分辨率: ' + config.device_width + 'x' + config.device_height)
  taskLog('日志文件: ' + _logFilePath)
  
  // 步骤1: 进入背包页面
  if (!enterBackpackPage()) {
    taskLog('进入背包页面失败，退出')
    commonFunction.minimize()
    sleep(500)
    killApps()
    exit()
  }
  
  // 分析背包页面
  analyzePage('背包页面')
  
  // 步骤2: 进入活力值兑换页面
  if (!enterExchangePage()) {
    taskLog('进入活力值兑换页面失败，退出')
    commonFunction.minimize()
    sleep(500)
    killApps()
    exit()
  }
  
  // 分析活力值兑换页面
  analyzePage('活力值兑换页面')
  
  taskLog('')
  taskLog('====== 测试限时道具兑换 结束 ======')
  
  // 退出
  sleep(2000)
  commonFunction.minimize()
  sleep(500)
  killApps()
  exit()
}

main()
