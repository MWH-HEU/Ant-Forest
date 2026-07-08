/*
 * 自动执行乐园任务
 * 1. 打开蚂蚁森林 → 通过图片识别进入乐园
 * 2. 进入限时福利
 * 3. 有"领取"先领取（排除"游戏充值优惠券待领取"）
 * 4. 没有领取，找"玩一玩"项目点击"去完成"
 * 5. 进入玩一玩页面，每半分钟搜索"能量"，变成"已完成"则退出，重复3-5
 * 6. 没有领取也没有新的玩一玩，返回原页面
 *
 * "乐园"入口是图片按钮，通过 resources/park_icon.png 图片模板匹配定位
 * 请先截取蚂蚁森林主页中"乐园"入口（熊猫图标+文字）的小图，
 * 保存为 resources/park_icon.png
 */
let { config, storage_name: _storage_name } = require('../config.js')(runtime, global)
let args = config.parseExecArgv()
let sRequire = require('../lib/SingletonRequirer.js')(runtime, global)
let automator = sRequire('Automator')
let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = sRequire('LogUtils')
let commonFunction = sRequire('CommonFunction')
let widgetUtils = sRequire('WidgetUtils')
let FloatyInstance = sRequire('FloatyUtil')
let LogFloaty = sRequire('LogFloaty')
let runningQueueDispatcher = sRequire('RunningQueueDispatcher')
let localOcrUtil = require('../lib/LocalOcrUtil.js')
let FileUtils = require('../lib/prototype/FileUtils.js')
runningQueueDispatcher.addRunningTask()

// 调试日志（仅悬浮窗显示，不写入文件）
function leyuanLog (msg) {
  LogFloaty.pushLog(msg)
}

if (!commonFunction.ensureAccessibilityEnabled()) {
  errorInfo('获取无障碍权限失败')
  exit()
}

// 音量由父脚本控制



// ============ 工具函数 ============

function openAntForest () {
  leyuanLog('正在打开蚂蚁森林')
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
  leyuanLog('蚂蚁森林已打开')
}

function waitAndClick (text, timeout) {
  timeout = timeout || 3000
  let btn = widgetUtils.widgetGetOne(text, timeout)
  if (btn) {
    leyuanLog('点击: ' + text)
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

function containsText (node, searchText) {
  if (!node) return false
  try {
    let t = node.text()
    if (t && t.toString().indexOf(searchText) >= 0) return true
  } catch (e) {}
  try {
    let d = node.desc()
    if (d && d.toString().indexOf(searchText) >= 0) return true
  } catch (e) {}
  try {
    let children = node.children()
    if (children) {
      for (let i = 0; i < children.size(); i++) {
        if (containsText(children.get(i), searchText)) return true
      }
    }
  } catch (e) {}
  return false
}

function parentContainsText (node, searchText, maxDepth) {
  maxDepth = maxDepth || 5
  let check = node
  for (let p = 0; p < maxDepth; p++) {
    try {
      let parent = check.parent()
      if (!parent) break
      if (containsText(parent, searchText)) return true
      check = parent
    } catch (e) {
      break
    }
  }
  return false
}

function getText (node) {
  try {
    let t = node.text()
    return t ? t.toString() : ''
  } catch (e) {
    return ''
  }
}

/**
 * 通过OCR识别"乐园"文字找到入口并点击
 */
function clickParkByOcr () {
  leyuanLog('通过OCR识别查找乐园入口')
  
  if (!localOcrUtil.enabled) {
    leyuanLog('OCR未启用，尝试通过控件查找')
    return clickParkByWidget()
  }
  
  // 请求截图权限并截图
  commonFunction.requestScreenCaptureOrRestart()
  sleep(500)
  let screen = commonFunction.captureScreen()
  if (!screen) {
    errorInfo('截图失败')
    return false
  }
  
  // 在屏幕下半部分识别（乐园入口在底部）
  let region = [0, parseInt(config.device_height * 0.6), config.device_width, parseInt(config.device_height * 0.35)]
  let results = localOcrUtil.recognizeWithBounds(screen, region, '乐园')
  screen.recycle()
  
  if (results && results.length > 0) {
    // 取第一个匹配结果
    let match = results[0]
    let bounds = match.bounds
    // 点击文字上方区域（图标位置，文字在图标下方）
    let clickX = bounds.centerX()
    let clickY = bounds.top - 60
    leyuanLog('OCR找到乐园: "' + match.label + '" 点击: (' + clickX + ', ' + clickY + ')')
    automator.click(clickX, clickY)
    sleep(2000)
    return true
  } else {
    leyuanLog('OCR未识别到乐园文字')
    return false
  }
}

/**
 * 通过控件查找乐园入口（OCR不可用时的降级方案）
 */
function clickParkByWidget () {
  // 遍历所有控件找包含"乐园"文字的
  leyuanLog('遍历控件查找乐园入口')
  try {
    let allTextViews = className('android.widget.TextView').find()
    if (allTextViews) {
      for (let i = 0; i < allTextViews.size(); i++) {
        let tv = allTextViews.get(i)
        try {
          let t = tv.text()
          if (t && t.toString().indexOf('乐园') >= 0) {
            let bounds = tv.bounds()
            let clickX = bounds.centerX()
            let clickY = bounds.top - 60
            leyuanLog('找到乐园文字控件，点击: (' + clickX + ', ' + clickY + ')')
            automator.click(clickX, clickY)
            sleep(2000)
            return true
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    leyuanLog('遍历控件异常: ' + e)
  }

  // 找"背包"推算
  leyuanLog('尝试通过背包推算乐园位置')
  let neighbor = widgetUtils.widgetGetOne('背包', 2000)
  if (neighbor) {
    let bounds = neighbor.bounds()
    let iconWidth = bounds.right - bounds.left
    let parkX = bounds.left - iconWidth - 10
    let parkY = bounds.centerY()
    leyuanLog('通过背包推算乐园: (' + parkX + ', ' + parkY + ')')
    automator.click(parkX, parkY)
    sleep(2000)
    return true
  }

  // 找"领奖励"推算
  neighbor = widgetUtils.widgetGetOne('领奖励', 2000)
  if (neighbor) {
    let bounds = neighbor.bounds()
    let iconWidth = bounds.right - bounds.left
    let parkX = bounds.left - iconWidth * 2 - 20
    let parkY = bounds.centerY()
    leyuanLog('通过领奖励推算乐园: (' + parkX + ', ' + parkY + ')')
    automator.click(parkX, parkY)
    sleep(2000)
    return true
  }

  // 找"赚能量"推算
  neighbor = widgetUtils.widgetGetOne('赚能量', 2000)
  if (neighbor) {
    let bounds = neighbor.bounds()
    let parkX = config.device_width * 0.22
    let parkY = bounds.top - 60
    leyuanLog('通过赚能量推算乐园: (' + parkX.toFixed(0) + ', ' + parkY.toFixed(0) + ')')
    automator.click(parkX, parkY)
    sleep(2000)
    return true
  }

  return false
}

/**
 * 通过OCR识别"限时福利"入口并点击
 */
function clickLimitedBenefit () {
  leyuanLog('通过OCR识别查找限时福利入口')
  
  if (localOcrUtil.enabled) {
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      // 限时福利在屏幕右下角
      let region = [parseInt(config.device_width * 0.5), parseInt(config.device_height * 0.5), parseInt(config.device_width * 0.5), parseInt(config.device_height * 0.5)]
      let results = localOcrUtil.recognizeWithBounds(screen, region, '限时福利')
      screen.recycle()
      if (results && results.length > 0) {
        let match = results[0]
        let bounds = match.bounds
        let clickX = bounds.centerX()
        let clickY = bounds.centerY()
        leyuanLog('OCR找到限时福利: "' + match.label + '" 点击: (' + clickX + ', ' + clickY + ')')
        automator.click(clickX, clickY)
        sleep(2000)
        return true
      }
    }
  }
  
  // OCR不可用时，尝试控件查找
  leyuanLog('尝试控件查找限时福利')
  if (waitAndClick('.*限时福利.*', 2000)) {
    return true
  }
  
  // 遍历所有TextView
  try {
    let allTextViews = className('android.widget.TextView').find()
    if (allTextViews) {
      for (let i = 0; i < allTextViews.size(); i++) {
        let tv = allTextViews.get(i)
        try {
          let t = tv.text()
          if (t && t.toString().indexOf('限时福利') >= 0) {
            let bounds = tv.bounds()
            leyuanLog('找到限时福利控件，点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
            automator.clickCenter(tv)
            sleep(2000)
            return true
          }
        } catch (e) {}
      }
    }
  } catch (e) {
    leyuanLog('遍历控件异常: ' + e)
  }
  
  return false
}

function tryClaimEnergy () {
  // 通过OCR识别"领取"或"去领取"按钮（只匹配有"玩一玩"提示的行）
  if (localOcrUtil.enabled) {
    leyuanLog('通过OCR识别领取按钮')
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      let region = [0, parseInt(config.device_height * 0.2), config.device_width, parseInt(config.device_height * 0.6)]
      let results = localOcrUtil.recognizeWithBounds(screen, region, '领取|去领取|玩一玩|游戏充值')
      screen.recycle()
      if (results && results.length > 0) {
        // 找出所有"领取"或"去领取"的位置
        let claimButtons = results.filter(function (r) {
          return (r.label.indexOf('领取') >= 0 || r.label.indexOf('去领取') >= 0) && r.label.indexOf('已领取') < 0
        })
        // 找出所有"玩一玩"的位置（用于确认是玩一玩行的领取）
        let playLabels = results.filter(function (r) { return r.label.indexOf('玩一玩') >= 0 })
        // 找出"游戏充值"的位置（用于排除）
        let rechargeLabels = results.filter(function (r) { return r.label.indexOf('游戏充值') >= 0 })
        
        for (let r = 0; r < claimButtons.length; r++) {
          let match = claimButtons[r]
          let bounds = match.bounds
          
          // 检查这个"领取"是否与某个"玩一玩"在同一行
          let hasPlayTag = false
          for (let c = 0; c < playLabels.length; c++) {
            if (Math.abs(playLabels[c].bounds.centerY() - bounds.centerY()) < 100) {
              hasPlayTag = true
              break
            }
          }
          if (!hasPlayTag) {
            leyuanLog('跳过非玩一玩行的领取')
            continue
          }
          
          // 排除"游戏充值优惠券"那一行的"去领取"
          let isRecharge = false
          for (let c = 0; c < rechargeLabels.length; c++) {
            if (Math.abs(rechargeLabels[c].bounds.centerY() - bounds.centerY()) < 100) {
              isRecharge = true
              break
            }
          }
          if (isRecharge) {
            leyuanLog('跳过游戏充值优惠券的领取')
            continue
          }
          leyuanLog('OCR找到领取: "' + match.label + '" 点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
          automator.click(bounds.centerX(), bounds.centerY())
          sleep(1500)
          return true
        }
      }
    }
  }
  
  // 降级：通过控件查找
  let allButtons = widgetUtils.widgetGetAll('领取|去领取', 2000)
  if (!allButtons) return false

  let len = allButtons.length
  for (let i = 0; i < len; i++) {
    let btn = allButtons.get(i)
    if (!btn) continue
    let btnText = getText(btn)
    if (btnText.indexOf('已领取') >= 0) continue
    if (parentContainsText(btn, '游戏充值', 5)) {
      leyuanLog('跳过游戏充值优惠券的领取')
      continue
    }
    leyuanLog('点击领取能量: ' + btnText)
    automator.clickCenter(btn)
    sleep(1500)
    return true
  }
  return false
}

function tryStartPlayGame () {
  // 方式1: 通过OCR识别"去完成"按钮（只匹配有"玩一玩"提示的行）
  if (localOcrUtil.enabled) {
    leyuanLog('通过OCR识别去完成按钮')
    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (screen) {
      // 在屏幕中间区域查找所有文字
      let region = [0, parseInt(config.device_height * 0.2), config.device_width, parseInt(config.device_height * 0.6)]
      let results = localOcrUtil.recognizeWithBounds(screen, region, '去完成|玩一玩')
      screen.recycle()
      if (results && results.length > 0) {
        // 找出所有"去完成"的位置
        let goButtons = results.filter(function (r) { return r.label.indexOf('去完成') >= 0 })
        // 找出所有"玩一玩"的位置
        let playLabels = results.filter(function (r) { return r.label.indexOf('玩一玩') >= 0 })
        
        for (let r = 0; r < goButtons.length; r++) {
          let match = goButtons[r]
          let bounds = match.bounds
          // 检查这个"去完成"是否与某个"玩一玩"在同一行
          let hasPlayTag = false
          for (let c = 0; c < playLabels.length; c++) {
            if (Math.abs(playLabels[c].bounds.centerY() - bounds.centerY()) < 100) {
              hasPlayTag = true
              break
            }
          }
          if (!hasPlayTag) {
            leyuanLog('跳过非玩一玩的去完成')
            continue
          }
          leyuanLog('OCR找到玩一玩的去完成: "' + match.label + '" 点击: (' + bounds.centerX() + ', ' + bounds.centerY() + ')')
          automator.click(bounds.centerX(), bounds.centerY())
          sleep(2000)
          return true
        }
      }
    }
  }
  
  // 方式2: 通过控件查找（只匹配有"玩一玩"前缀的项目）
  let playItems = widgetUtils.widgetGetAll('玩一玩.*', 2000)
  if (!playItems) return false

  let len = playItems.length
  for (let i = 0; i < len; i++) {
    let item = playItems.get(i)
    if (!item) continue
    let itemText = getText(item)
    leyuanLog('检查玩一玩项目: ' + itemText)
    try {
      // 向上查找5层父容器，找"去完成"按钮
      let check = item
      for (let depth = 0; depth < 5; depth++) {
        let parent = check.parent()
        if (!parent) break
        let children = parent.children()
        for (let c = 0; c < children.size(); c++) {
          let child = children.get(c)
          let childText = getText(child)
          if (/去完成/.test(childText) && childText.indexOf('已领取') < 0) {
            leyuanLog('找到去完成按钮（第' + depth + '层父容器）: ' + childText)
            automator.clickCenter(child)
            sleep(2000)
            return true
          }
        }
        check = parent
      }
      leyuanLog('  未找到去完成按钮')
    } catch (e) {
      leyuanLog('  遍历异常: ' + e)
      continue
    }
  }
  return false
}

function waitForGameComplete () {
  leyuanLog('进入玩一玩页面，等待任务完成（最多检查12次）')
  sleep(2000)

  let maxChecks = 12
  for (let check = 1; check <= maxChecks; check++) {
    sleep(30000)
    leyuanLog('第' + check + '/' + maxChecks + '次检查玩一玩状态...')
    let completed = widgetUtils.widgetGetOne('.*已完成.*', 1000)
    if (completed) {
      leyuanLog('检测到已完成，退出玩一玩')
      exitPlayGame()
      return true
    }
  }
  leyuanLog('检查次数已用完（' + maxChecks + '次），退出玩一玩')
  exitPlayGame()
  return false
}

/**
 * 退出玩一玩页面并返回乐园/限时福利
 * 先尝试进限时福利，失败则在乐园页面继续
 */
function exitPlayGame () {
  leyuanLog('返回桌面并重新进入')
  // 回到桌面
  commonFunction.minimize()
  sleep(1000)
  
  // 重新打开支付宝进入限时福利
  openAntForest()
  
  // 进入乐园
  leyuanLog('重新进入乐园')
  if (!clickParkByOcr()) {
    leyuanLog('重新进入乐园失败')
    return
  }
  sleep(3000)
  
  // 先检查乐园页面是否有直接任务
  if (tryClaimEnergy()) return
  if (tryStartPlayGame()) return
  
  // 没有直接任务，尝试进入限时福利
  leyuanLog('尝试进入限时福利')
  if (clickLimitedBenefit()) {
    sleep(1500)
  } else {
    leyuanLog('限时福利未自动打开，在乐园页面继续')
  }
}

// ============ 主流程 ============

function main () {
  // 1. 打开蚂蚁森林
  openAntForest()

  // 2. 进入乐园
  leyuanLog('查找乐园入口')
  if (!clickParkByOcr()) {
    errorInfo('无法定位乐园入口')
    exit()
  }

  // 3. 进入乐园后先检查是否有可直接操作的任务
  sleep(3000)
  leyuanLog('检查乐园页面是否有可直接操作的任务')
  
  // 先尝试领取和去完成（直接在乐园页面操作）
  let hasDirectTasks = false
  for (let round = 0; round < 20; round++) {
    leyuanLog('=== 乐园页面 第 ' + (round + 1) + ' 轮 ===')
    
    if (tryClaimEnergy()) {
      hasDirectTasks = true
      continue
    }
    
    if (tryStartPlayGame()) {
      hasDirectTasks = true
      waitForGameComplete()
      continue
    }
    
    break
  }
  
  // 如果没有直接任务，进入限时福利
  if (!hasDirectTasks) {
    leyuanLog('乐园页面无直接任务，进入限时福利')
    if (!clickLimitedBenefit()) {
      errorInfo('未找到限时福利入口')
      exit()
    }
    sleep(1500)
  } else {
    // 有直接任务且完成后，再进入限时福利
    leyuanLog('乐园页面任务完成，进入限时福利')
    if (!clickLimitedBenefit()) {
      leyuanLog('未找到限时福利入口，可能已自动打开')
    }
    sleep(1500)
  }

  // 限时福利页面循环执行：领取 → 玩一玩 → 检查完成
  let maxRounds = 20
  for (let round = 0; round < maxRounds; round++) {
    leyuanLog('=== 限时福利 第 ' + (round + 1) + ' 轮 ===')

    if (tryClaimEnergy()) {
      continue
    }

    if (tryStartPlayGame()) {
      waitForGameComplete()
      continue
    }

    leyuanLog('没有更多可领取的能量和玩一玩任务，结束')
    break
  }

  // 返回原页面
  leyuanLog('任务完成，返回原页面')
  commonFunction.minimize()
  sleep(500)
  runningQueueDispatcher.removeRunningTask()
    exit()
}

main()
