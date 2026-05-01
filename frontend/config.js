/**
 * config.js — 全局配置
 * 部署时只需修改此文件中的 API_BASE_URL。
 */
const CONFIG = {
  // AI 分析后端
  API_BASE_URL: 'http://localhost:5001',
  // 书架/进度后端
  LIBRARY_BASE_URL: 'http://localhost:5002',

  READER: {
    SPREAD: 'none',        // 'none' | 'auto' | 'always'
    // paginated：分页模式，日文竖排 epub 使用此模式
    // scrolled-doc：整章滚动，仅适合横排 epub
    FLOW: 'paginated',


    // 字体大小（%）
    FONT_SIZE_DEFAULT: 130,
    FONT_SIZE_STEP: 10,
    FONT_SIZE_MIN: 60,
    FONT_SIZE_MAX: 200,
  },
};
