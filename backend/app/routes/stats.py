"""
统计信息路由
提供日志统计查询接口
"""
from flask import Blueprint, jsonify
from datetime import datetime
import os
import re
from collections import Counter

bp = Blueprint('stats', __name__)


@bp.route('/api/stats', methods=['GET'])
def get_stats():
    """
    获取统计信息
    解析日志文件，返回统计数据
    """
    try:
        stats = _parse_logs()
        return jsonify(stats), 200
    except Exception as e:
        return jsonify({
            'error': str(e),
            'timestamp': datetime.now().isoformat()
        }), 500


def _parse_logs():
    """解析日志文件，生成统计信息"""
    access_log_path = 'logs/access.log'
    error_log_path = 'logs/error.log'
    
    # 初始化统计数据
    stats = {
        'total_requests': 0,
        'success_count': 0,
        'error_count': 0,
        'by_endpoint': Counter(),
        'by_status': Counter(),
        'text_lengths': [],
        'response_times': [],
        'timestamp': datetime.now().isoformat()
    }
    
    # 解析访问日志
    if os.path.exists(access_log_path):
        with open(access_log_path, 'r', encoding='utf-8') as f:
            for line in f:
                _parse_log_line(line, stats)
    
    # 解析错误日志
    if os.path.exists(error_log_path):
        with open(error_log_path, 'r', encoding='utf-8') as f:
            for line in f:
                _parse_log_line(line, stats)
    
    # 计算统计值
    stats['success_rate'] = (
        stats['success_count'] / stats['total_requests']
        if stats['total_requests'] > 0 else 0
    )
    
    stats['avg_text_length'] = (
        sum(stats['text_lengths']) / len(stats['text_lengths'])
        if stats['text_lengths'] else 0
    )
    
    stats['avg_response_time'] = (
        sum(stats['response_times']) / len(stats['response_times'])
        if stats['response_times'] else 0
    )
    
    # 转换 Counter 为字典
    stats['by_endpoint'] = dict(stats['by_endpoint'])
    stats['by_status'] = dict(stats['by_status'])
    
    # 移除原始数组（前端不需要）
    del stats['text_lengths']
    del stats['response_times']
    
    return stats


def _parse_log_line(line: str, stats: dict):
    """解析单行日志"""
    try:
        # 提取请求路径
        path_match = re.search(r'(GET|POST|PUT|DELETE)\s+(/api/\S+)', line)
        if path_match:
            endpoint = path_match.group(2)
            stats['by_endpoint'][endpoint] += 1
            stats['total_requests'] += 1
        
        # 提取状态码
        status_match = re.search(r'Status:\s+(\d+)', line)
        if status_match:
            status = int(status_match.group(1))
            stats['by_status'][str(status)] += 1
            if 200 <= status < 400:
                stats['success_count'] += 1
            else:
                stats['error_count'] += 1
        
        # 提取响应时间
        time_match = re.search(r'Time:\s+([\d.]+)s', line)
        if time_match:
            response_time = float(time_match.group(1))
            stats['response_times'].append(response_time)
        
        # 提取文本长度
        length_match = re.search(r'TextLen:\s+(\d+)', line)
        if length_match:
            text_length = int(length_match.group(1))
            stats['text_lengths'].append(text_length)
    
    except Exception as e:
        # 忽略解析错误
        pass