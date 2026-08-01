/**
 * WidgetInspector - 控件检测公共函数库
 * 
 * 提供三种页面检测方法 + 可见区域过滤版 + 辅助工具：
 *   1. detectByWidget()          - 控件查找 Button + TextView
 *   2. detectByWidgetVisible()   - 仅可见区域内的 Button + TextView
 *   3. detectAllNodes()          - 所有控件检测（含可点击、className）
 *   4. detectAllNodesVisible()   - 仅可见区域内的所有控件
 *   5. detectByOcr()             - OCR 识别所有文字
 *   6. detectAll()               - 一键执行全部三种方法
 *   7. getNodeText()             - 安全获取控件文本
 *   8. getNodeBounds()           - 安全获取控件 bounds
 * 
 * 用法：
 *   let WidgetInspector = require('../lib/WidgetInspector.js')(runtime, global)
 *   WidgetInspector.detectByWidget({ onLog: debugInfo })
 */

module.exports = function (runtime, global) {
  let sRequire = require('./SingletonRequirer.js')(runtime, global)
  let { debugInfo, warnInfo, errorInfo, infoLog, logInfo, debugForDev } = sRequire('LogUtils')
  let commonFunction = sRequire('CommonFunction')
  let localOcrUtil = require('./LocalOcrUtil.js')

  // ==================== 内部工具 ====================

  /**
   * 安全获取控件文本
   * @param {UiObject} node
   * @returns {string}
   */
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

  /**
   * 安全获取控件 bounds
   * @param {UiObject} node
   * @returns {({left:number,top:number,right:number,bottom:number,centerX:function,centerY:function})|null}
   */
  function getNodeBounds (node) {
    try {
      return node.bounds()
    } catch (e) {
      return null
    }
  }

  // ==================== 默认回调 ====================

  /** 默认日志输出回调（默认不写入日志，仅保留函数签名避免报错） */
  function defaultLogCallback (msg) {
    // debugInfo(msg)  // 默认不写入日志
  }

  // ==================== 公开方法 ====================

  /**
   * 方法1: 控件查找 Button + TextView
   * @param {Object} [opts]
   * @param {function(string)} [opts.onLog]       - 日志回调，默认 debugInfo
   * @param {function(Object)} [opts.onButton]    - 每个 Button 的回调，参数 { index, text, bounds }
   * @param {function(Object)} [opts.onTextView]  - 每个 TextView 的回调，参数 { index, text, bounds }
   * @returns {{ buttons: Object[], textViews: Object[] }}
   */
  function detectByWidget (opts) {
    opts = opts || {}
    let log = opts.onLog || defaultLogCallback
    let result = { buttons: [], textViews: [] }

    log('>>> 方法1: 控件查找 Button + TextView')

    // ---- Button ----
    try {
      let allNodes = className('android.widget.Button').find()
      let count = allNodes ? allNodes.size() : 0
      log('找到 ' + count + ' 个 Button 控件')
      for (let i = 0; i < count; i++) {
        try {
          let node = allNodes.get(i)
          let text = getNodeText(node)
          let bounds = getNodeBounds(node)
          let info = { index: i, text: text, bounds: bounds }
          result.buttons.push(info)
          if (bounds) {
            log('  Button[' + i + ']: text="' + text + '" bounds=(' +
              bounds.left + ',' + bounds.top + ',' + bounds.right + ',' + bounds.bottom +
              ') center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
          } else {
            log('  Button[' + i + ']: text="' + text + '" bounds=null')
          }
          if (opts.onButton) opts.onButton(info)
        } catch (e) {
          log('  Button[' + i + '] 异常: ' + e)
        }
      }
    } catch (e) {
      log('  控件查找 Button 异常: ' + e)
    }

    // ---- TextView ----
    try {
      let allNodes = className('android.widget.TextView').find()
      let count = allNodes ? allNodes.size() : 0
      log('找到 ' + count + ' 个 TextView 控件')
      for (let i = 0; i < count; i++) {
        try {
          let node = allNodes.get(i)
          let text = getNodeText(node)
          let bounds = getNodeBounds(node)
          let info = { index: i, text: text, bounds: bounds }
          result.textViews.push(info)
          if (bounds) {
            log('  TextView[' + i + ']: text="' + text + '" bounds=(' +
              bounds.left + ',' + bounds.top + ',' + bounds.right + ',' + bounds.bottom +
              ') center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
          } else {
            log('  TextView[' + i + ']: text="' + text + '" bounds=null')
          }
          if (opts.onTextView) opts.onTextView(info)
        } catch (e) {
          log('  TextView[' + i + '] 异常: ' + e)
        }
      }
    } catch (e) {
      log('  控件查找 TextView 异常: ' + e)
    }

    return result
  }

  /**
   * 方法2: 所有控件检测（含可点击属性、className）
   * @param {Object} [opts]
   * @param {function(string)} [opts.onLog]     - 日志回调
   * @param {function(Object)} [opts.onNode]    - 每个控件的回调，参数 { index, text, className, clickable, bounds }
   * @returns {{ nodes: Object[] }}
   */
  function detectAllNodes (opts) {
    opts = opts || {}
    let log = opts.onLog || defaultLogCallback
    let result = { nodes: [] }

    log('>>> 方法2: 所有控件检测')
    try {
      let allNodes = selector().find()
      let count = allNodes ? allNodes.size() : 0
      log('找到 ' + count + ' 个控件')
      for (let i = 0; i < count; i++) {
        try {
          let node = allNodes.get(i)
          let text = getNodeText(node)
          let className = ''
          try { className = node.className() } catch (e) {}
          let clickable = false
          try { clickable = node.clickable() } catch (e) {}
          let bounds = getNodeBounds(node)
          let info = { index: i, text: text, className: className, clickable: clickable, bounds: bounds }
          result.nodes.push(info)
          if (bounds) {
            log('  Node[' + i + ']: class=' + className + ' clickable=' + clickable +
              ' text="' + text + '" center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
          } else {
            log('  Node[' + i + ']: class=' + className + ' clickable=' + clickable + ' text="' + text + '"')
          }
          if (opts.onNode) opts.onNode(info)
        } catch (e) {}
      }
    } catch (e) {
      log('  控件检测异常: ' + e)
    }

    return result
  }

  /**
   * 方法3: OCR 识别所有文字
   * @param {Object} [opts]
   * @param {function(string)} [opts.onLog]      - 日志回调
   * @param {function(Object)} [opts.onMatch]    - 每个 OCR 匹配结果的回调，参数 { index, label, bounds }
   * @returns {{ results: Object[] }}
   */
  function detectByOcr (opts) {
    opts = opts || {}
    let log = opts.onLog || defaultLogCallback
    let result = { results: [] }

    log('>>> 方法3: OCR 识别所有文字')
    if (!localOcrUtil.enabled) {
      log('  OCR 未启用，跳过')
      return result
    }

    commonFunction.requestScreenCaptureOrRestart()
    sleep(500)
    let screen = commonFunction.captureScreen()
    if (!screen) {
      log('  截图失败')
      return result
    }

    let matches = localOcrUtil.recognizeWithBounds(screen, null, null)
    screen.recycle()

    if (matches && matches.length > 0) {
      log('OCR 识别到 ' + matches.length + ' 个文字区域')
      for (let i = 0; i < matches.length; i++) {
        let match = matches[i]
        let bounds = match.bounds
        let info = { index: i, label: match.label, bounds: bounds }
        result.results.push(info)
        log('  OCR[' + i + ']: text="' + match.label + '" bounds=(' +
          bounds.left + ',' + bounds.top + ',' + bounds.right + ',' + bounds.bottom +
          ') center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
        if (opts.onMatch) opts.onMatch(info)
      }
    } else {
      log('  OCR 未识别到任何文字')
    }

    return result
  }



  /**
   * 一键执行全部三种检测方法
   * @param {Object} [opts] - 透传给各方法的参数
   * @returns {{ widget, allNodes, ocr }}
   */
  function detectAll (opts) {
    return {
      widget: detectByWidget(opts),
      allNodes: detectAllNodes(opts),
      ocr: detectByOcr(opts)
    }
  }

  /**
   * 判断控件是否对用户可见（基于 Android 无障碍 API 的 visibleToUser）
   * @param {UiObject} node
   * @returns {boolean}
   */
  function isVisibleToUser (node) {
    try {
      return node.visibleToUser()
    } catch (e) {
      return false
    }
  }

  /**
   * 方法1-可见区域版: 仅返回对用户可见的 Button + TextView
   * @param {Object} [opts] - 同 detectByWidget
   * @returns {{ buttons: Object[], textViews: Object[] }}
   */
  function detectByWidgetVisible (opts) {
    opts = opts || {}
    let log = opts.onLog || defaultLogCallback
    let result = { buttons: [], textViews: [] }

    log('>>> 方法1(可见区域): 控件查找 Button + TextView')

    // ---- Button ----
    try {
      let allNodes = className('android.widget.Button').find()
      let count = allNodes ? allNodes.size() : 0
      log('找到 ' + count + ' 个 Button 控件')
      for (let i = 0; i < count; i++) {
        try {
          let node = allNodes.get(i)
          if (!isVisibleToUser(node)) continue
          let text = getNodeText(node)
          let bounds = getNodeBounds(node)
          let info = { index: i, text: text, bounds: bounds }
          result.buttons.push(info)
          if (bounds) {
            log('  Button[' + i + ']: text="' + text + '" bounds=(' +
              bounds.left + ',' + bounds.top + ',' + bounds.right + ',' + bounds.bottom +
              ') center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
          } else {
            log('  Button[' + i + ']: text="' + text + '" bounds=null')
          }
          if (opts.onButton) opts.onButton(info)
        } catch (e) {
          log('  Button[' + i + '] 异常: ' + e)
        }
      }
    } catch (e) {
      log('  控件查找 Button 异常: ' + e)
    }

    // ---- TextView ----
    try {
      let allNodes = className('android.widget.TextView').find()
      let count = allNodes ? allNodes.size() : 0
      log('找到 ' + count + ' 个 TextView 控件')
      for (let i = 0; i < count; i++) {
        try {
          let node = allNodes.get(i)
          if (!isVisibleToUser(node)) continue
          let text = getNodeText(node)
          let bounds = getNodeBounds(node)
          let info = { index: i, text: text, bounds: bounds }
          result.textViews.push(info)
          if (bounds) {
            log('  TextView[' + i + ']: text="' + text + '" bounds=(' +
              bounds.left + ',' + bounds.top + ',' + bounds.right + ',' + bounds.bottom +
              ') center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
          } else {
            log('  TextView[' + i + ']: text="' + text + '" bounds=null')
          }
          if (opts.onTextView) opts.onTextView(info)
        } catch (e) {
          log('  TextView[' + i + '] 异常: ' + e)
        }
      }
    } catch (e) {
      log('  控件查找 TextView 异常: ' + e)
    }

    log('  (可见区域过滤后: ' + result.buttons.length + ' 个 Button, ' + result.textViews.length + ' 个 TextView)')
    return result
  }

  /**
   * 方法2-可见区域版: 仅返回对用户可见的控件
   * @param {Object} [opts] - 同 detectAllNodes
   * @returns {{ nodes: Object[] }}
   */
  function detectAllNodesVisible (opts) {
    opts = opts || {}
    let log = opts.onLog || defaultLogCallback
    let result = { nodes: [] }

    log('>>> 方法2(可见区域): 所有控件检测')
    try {
      let allNodes = selector().find()
      let count = allNodes ? allNodes.size() : 0
      log('找到 ' + count + ' 个控件')
      for (let i = 0; i < count; i++) {
        try {
          let node = allNodes.get(i)
          if (!isVisibleToUser(node)) continue
          let text = getNodeText(node)
          let className = ''
          try { className = node.className() } catch (e) {}
          let clickable = false
          try { clickable = node.clickable() } catch (e) {}
          let bounds = getNodeBounds(node)
          let info = { index: i, text: text, className: className, clickable: clickable, bounds: bounds }
          result.nodes.push(info)
          if (bounds) {
            log('  Node[' + i + ']: class=' + className + ' clickable=' + clickable +
              ' text="' + text + '" center=(' + bounds.centerX() + ',' + bounds.centerY() + ')')
          } else {
            log('  Node[' + i + ']: class=' + className + ' clickable=' + clickable + ' text="' + text + '"')
          }
          if (opts.onNode) opts.onNode(info)
        } catch (e) {}
      }
    } catch (e) {
      log('  控件检测异常: ' + e)
    }

    log('  (可见区域过滤后: ' + result.nodes.length + ' 个控件)')
    return result
  }

  return {
    getNodeText: getNodeText,
    getNodeBounds: getNodeBounds,
    detectByWidget: detectByWidget,
    detectByWidgetVisible: detectByWidgetVisible,
    detectAllNodes: detectAllNodes,
    detectAllNodesVisible: detectAllNodesVisible,
    detectByOcr: detectByOcr,
    detectAll: detectAll
  }
}
