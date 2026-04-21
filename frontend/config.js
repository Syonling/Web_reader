/**
 * config.js — 全局配置
 * 部署时只需修改此文件中的 API_BASE_URL。
 */
const CONFIG = {
  // 后端地址：本地测试用 localhost，部署时改为服务器 URL
  API_BASE_URL: 'http://localhost:5001',

  READER: {
    SPREAD: 'none',        // 'none' | 'auto' | 'always'
    // paginated：分页模式，日文竖排 epub 使用此模式
    // scrolled-doc：整章滚动，仅适合横排 epub
    FLOW: 'paginated',


    // 字体大小（%）
    FONT_SIZE_DEFAULT: 100,
    FONT_SIZE_STEP: 10,
    FONT_SIZE_MIN: 60,
    FONT_SIZE_MAX: 200,
  },
};
