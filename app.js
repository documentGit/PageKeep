// ============================================
// PageKeep - Client Script (v4)
// 保存・更新・閲覧・削除すべて統合
// ============================================
(async function() {
  'use strict';
  
  const REQUIRED_GAS_VERSION = 5;
  
  // Trusted Types
  let trustedHTMLPolicy = null;
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    try {
      trustedHTMLPolicy = window.trustedTypes.createPolicy('pagekeep-html-' + Date.now(), {
        createHTML: (s) => s
      });
    } catch (e) {}
  }
  
  function setHTML(element, html) {
    if (trustedHTMLPolicy) {
      element.innerHTML = trustedHTMLPolicy.createHTML(html);
    } else {
      element.innerHTML = html;
    }
  }
  
  const gasUrl = window.__PAGEKEEP_GAS_URL__;
  const secret = window.__PAGEKEEP_SECRET__;
  
  if (!gasUrl || !secret) {
    alert('PageKeep: 設定が不完全です。');
    return;
  }
  
  const existingOverlay = document.getElementById('__pagekeep_overlay__');
  if (existingOverlay) existingOverlay.remove();
  
  // ============================================
  // 定数
  // ============================================
  const STATUSES = [
    { value: 'unread',   label: '📖 未読' },
    { value: 'reading',  label: '👁 読書中' },
    { value: 'done',     label: '✅ 読了' },
    { value: 'archive',  label: '📦 アーカイブ' },
  ];
  
  const FLAGS = [
    { value: 'important', label: '⭐ 重要' },
    { value: 'favorite',  label: '❤️ お気に入り' },
  ];
  
  function statusLabel(value) {
    const s = STATUSES.find(x => x.value === value);
    return s ? s.label : '';
  }
  function flagLabel(value) {
    const f = FLAGS.find(x => x.value === value);
    return f ? f.label : '';
  }
  
  // 共有データ（メイン処理で取得後、各画面に渡す）
  const state = {
    pageData: null,
    existing: null,
    prefixes: [],
    allTags: [],
    allPages: [],
  };
  
  // ============================================
  // URL正規化
  // ============================================
  function normalizeUrl(url) {
    let u;
    try { u = new URL(url); } catch { return url; }
    
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid',
      'ref', 'ref_src', 'ref_url', '_ga', '_gl', 'igshid', 'spm',
    ];
    trackingParams.forEach(p => u.searchParams.delete(p));
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
      u.pathname = u.pathname.slice(0, -1);
    }
    
    if (/(?:^|\.)youtube\.com$|^youtu\.be$/.test(u.hostname)) {
      let videoId = null;
      if (u.hostname === 'youtu.be') {
        videoId = u.pathname.slice(1);
        u.hostname = 'www.youtube.com';
        u.pathname = '/watch';
      } else {
        u.hostname = 'www.youtube.com';
        const embedMatch = u.pathname.match(/^\/embed\/([^\/]+)/);
        const shortsMatch = u.pathname.match(/^\/shorts\/([^\/]+)/);
        if (embedMatch) { videoId = embedMatch[1]; u.pathname = '/watch'; }
        else if (shortsMatch) { videoId = shortsMatch[1]; u.pathname = '/watch'; }
        else videoId = u.searchParams.get('v');
      }
      if (u.pathname === '/watch' && videoId) {
        const newParams = new URLSearchParams();
        newParams.set('v', videoId);
        u.search = newParams.toString();
      }
    }
    return u.toString();
  }
  
  function collectPageData() {
    const url = location.href;
    const normalizedUrl = normalizeUrl(url);
    const title = collectTitle();
    let excerpt = window.getSelection().toString().trim();
    if (!excerpt) {
      excerpt = (
        document.querySelector('meta[property="og:description"]')?.content ||
        document.querySelector('meta[name="description"]')?.content || ''
      ).trim();
    }
    return { url, normalizedUrl, title, excerpt };
  }
  
  function collectTitle() {
    const isYouTube = /(?:^|\.)youtube\.com$|^youtu\.be$/.test(location.hostname);
    
    // YouTube専用：DOM から動画タイトルを取得
    if (isYouTube) {
      const ytTitle = pickYouTubeTitle();
      if (ytTitle) return ytTitle;
    }
    
    // 通常：og:title → document.title
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content?.trim();
    if (ogTitle && ogTitle !== 'YouTube') return ogTitle;
    
    const docTitle = (document.title || '').trim();
    // 「タイトル - YouTube」形式から動画タイトル部分を抽出
    if (docTitle && docTitle !== 'YouTube') {
      return docTitle.replace(/\s*-\s*YouTube\s*$/, '');
    }
    
    return docTitle;
  }
  
  function pickYouTubeTitle() {
    // 複数のセレクタで試す（YouTubeのUI変更に対応）
    const selectors = [
      'ytd-watch-metadata h1 yt-formatted-string',
      'ytd-watch-metadata h1',
      'h1.ytd-watch-metadata',
      'h1.title',
      '#title h1',
      '#container h1.title',
      'h1.ytd-video-primary-info-renderer',
    ];
    
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) {
        const text = (el.textContent || '').trim();
        if (text && text !== 'YouTube') return text;
      }
    }
    
    return null;
  }
  
  async function callGas(action, payload) {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, secret, ...payload }),
    });
    return await res.json();
  }
  
  // ============================================
  // ユーティリティ
  // ============================================
  function normalizeForCompare(s) {
    return String(s || '').toLowerCase().normalize('NFKC');
  }
  
  function findSimilarTags(input, existingTags) {
    const norm = normalizeForCompare(input);
    return existingTags.filter(t => {
      const tNorm = normalizeForCompare(t);
      return tNorm === norm && t !== input;
    });
  }
  
  function escapeAttr(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeText(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  
  function formatDateShort(isoStr) {
    if (!isoStr) return '';
    const d = new Date(isoStr);
    const m = d.getMonth() + 1;
    const day = d.getDate();
    return `${m}/${day}`;
  }
  
  function truncate(str, n) {
    if (!str) return '';
    return str.length > n ? str.slice(0, n) + '…' : str;
  }
  
  // ============================================
  // オーバーレイ
  // ============================================
  function buildOverlay() {
    const overlay = document.createElement('div');
    overlay.id = '__pagekeep_overlay__';
    setHTML(overlay, `
      <style>
        #__pagekeep_overlay__ {
          position: fixed; inset: 0;
          background: rgba(0,0,0,0.6);
          z-index: 2147483647;
          display: flex; align-items: center; justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: 16px; color: #1a1a1a;
        }
        #__pagekeep_overlay__ * { box-sizing: border-box; }
        #__pagekeep_overlay__ .pk-modal {
          background: #fff; border-radius: 12px;
          width: min(560px, 94%); max-height: 92vh;
          overflow-y: auto; padding: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        #__pagekeep_overlay__ .pk-modal-list {
          width: min(720px, 96%);
        }
        #__pagekeep_overlay__ .pk-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 12px; gap: 8px;
        }
        #__pagekeep_overlay__ h2 { margin: 0; font-size: 18px; }
        #__pagekeep_overlay__ .pk-header-actions {
          display: flex; gap: 6px; align-items: center;
        }
        #__pagekeep_overlay__ .pk-mode-btn {
          background: #f0f0f0; border: 1px solid #ccc;
          padding: 6px 12px; border-radius: 6px;
          font-size: 13px; cursor: pointer; color: #333;
        }
        #__pagekeep_overlay__ .pk-mode-btn:hover {
          background: #e0e0e0;
        }
        #__pagekeep_overlay__ .pk-close {
          background: none; border: none; font-size: 24px;
          cursor: pointer; padding: 0 8px; color: #666;
        }
        #__pagekeep_overlay__ label {
          display: block; font-size: 12px; color: #666;
          margin: 12px 0 4px;
        }
        #__pagekeep_overlay__ label.required::after {
          content: ' *'; color: #c00;
        }
        #__pagekeep_overlay__ input,
        #__pagekeep_overlay__ select,
        #__pagekeep_overlay__ textarea {
          width: 100%; padding: 10px;
          border: 1px solid #ddd; border-radius: 6px;
          font-size: 16px; font-family: inherit;
          background: #fff; color: #1a1a1a;
        }
        #__pagekeep_overlay__ textarea {
          min-height: 70px; resize: vertical;
        }
        #__pagekeep_overlay__ .pk-status-banner {
          padding: 8px 12px; border-radius: 6px;
          font-size: 14px; margin-bottom: 12px;
        }
        #__pagekeep_overlay__ .pk-status-banner.new {
          background: #e3f2fd; color: #0066cc;
        }
        #__pagekeep_overlay__ .pk-status-banner.existing {
          background: #fff3cd; color: #856404;
        }
        #__pagekeep_overlay__ .pk-status-banner.error {
          background: #f8d7da; color: #721c24;
        }
        #__pagekeep_overlay__ .pk-status-banner a {
          color: inherit; text-decoration: underline;
        }
        #__pagekeep_overlay__ .pk-tag-input-row {
          display: flex; gap: 6px;
        }
        #__pagekeep_overlay__ .pk-tag-input-row select {
          flex: 0 0 130px;
          min-width: 0;
          padding: 10px 4px;
        }
        #__pagekeep_overlay__ .pk-tag-input-row input {
          flex: 1;
          min-width: 0;
        }
        #__pagekeep_overlay__ .pk-tag-add-btn {
          flex: 0 0 auto; padding: 0 12px;
          border: 1px solid #ccc; background: #f0f0f0; color: #666;
          border-radius: 6px; cursor: pointer; font-size: 16px;
        }
        #__pagekeep_overlay__ .pk-tag-add-btn:hover { background: #e0e0e0; }
        #__pagekeep_overlay__ .pk-tag-area { margin-top: 8px; }
        #__pagekeep_overlay__ .pk-tag-group-title {
          font-size: 11px; color: #999; margin: 8px 0 4px;
        }
        #__pagekeep_overlay__ .pk-tag-chip {
          display: inline-block;
          padding: 4px 10px; margin: 2px 4px 2px 0;
          border-radius: 14px; font-size: 13px;
          background: #eee; color: #333; cursor: pointer;
          user-select: none;
          border: 1px solid transparent;
        }
        #__pagekeep_overlay__ .pk-tag-chip.selected {
          background: #0066cc; color: #fff;
        }
        #__pagekeep_overlay__ .pk-tag-chip:hover {
          border-color: #0066cc;
        }
        #__pagekeep_overlay__ .pk-tag-chip .pk-remove {
          margin-left: 6px; font-weight: bold;
        }
        #__pagekeep_overlay__ .pk-selected-tags {
          min-height: 32px; padding: 6px;
          background: #f7f7f7; border-radius: 6px;
          margin-bottom: 8px;
        }
        #__pagekeep_overlay__ .pk-selected-tags:empty::before {
          content: '（タグ未選択）';
          color: #999; font-size: 13px;
        }
        #__pagekeep_overlay__ .pk-radio-group,
        #__pagekeep_overlay__ .pk-checkbox-group {
          display: flex; flex-wrap: wrap; gap: 4px;
        }
        #__pagekeep_overlay__ .pk-radio-label,
        #__pagekeep_overlay__ .pk-checkbox-label {
          display: inline-flex; align-items: center;
          padding: 6px 12px; border: 1px solid #ddd;
          border-radius: 6px; cursor: pointer;
          font-size: 14px; user-select: none;
          background: #fff;
        }
        #__pagekeep_overlay__ .pk-radio-label input,
        #__pagekeep_overlay__ .pk-checkbox-label input {
          margin-right: 6px; width: auto;
        }
        #__pagekeep_overlay__ .pk-radio-label.checked {
          background: #0066cc; color: #fff; border-color: #0066cc;
        }
        #__pagekeep_overlay__ .pk-checkbox-label.checked {
          background: #fff8e1; border-color: #ffa000;
        }
        #__pagekeep_overlay__ .pk-warning {
          font-size: 12px; color: #d95f00;
          margin-top: 4px; padding: 4px 8px;
          background: #fff8e1; border-radius: 4px;
        }
        #__pagekeep_overlay__ .pk-actions {
          display: flex; gap: 8px; justify-content: space-between;
          align-items: center;
          margin-top: 16px; flex-wrap: wrap;
        }
        #__pagekeep_overlay__ .pk-actions-right {
          display: flex; gap: 8px;
        }
        #__pagekeep_overlay__ button.pk-btn {
          padding: 10px 16px; border-radius: 6px;
          font-size: 15px; cursor: pointer;
          border: 1px solid #ddd; background: #fff;
        }
        #__pagekeep_overlay__ button.pk-btn-primary {
          background: #0066cc; color: #fff; border: none;
        }
        #__pagekeep_overlay__ button.pk-btn-primary:disabled {
          opacity: 0.5; cursor: not-allowed;
        }
        #__pagekeep_overlay__ button.pk-btn-update {
          background: #ff8c00; color: #fff; border: none;
        }
        #__pagekeep_overlay__ button.pk-btn-danger {
          background: #fff; color: #c00; border: 1px solid #c00;
        }
        #__pagekeep_overlay__ button.pk-btn-danger:hover {
          background: #fee;
        }
        #__pagekeep_overlay__ .pk-success {
          text-align: center; padding: 24px 12px;
        }
        #__pagekeep_overlay__ .pk-success a {
          color: #0066cc; text-decoration: none;
        }
        
        /* === 閲覧画面 === */
        #__pagekeep_overlay__ .pk-list-search {
          margin-bottom: 12px;
        }
        #__pagekeep_overlay__ .pk-list-search input {
          padding: 10px 12px;
        }
        #__pagekeep_overlay__ .pk-filter-row {
          display: flex; flex-wrap: wrap; gap: 6px;
          margin-bottom: 12px;
        }
        #__pagekeep_overlay__ .pk-filter-row select {
          flex: 1 1 auto; min-width: 100px;
          padding: 6px 4px; font-size: 13px;
        }
        #__pagekeep_overlay__ .pk-filter-tag-area {
          margin-bottom: 12px;
          padding: 8px; background: #f7f7f7; border-radius: 6px;
        }
        #__pagekeep_overlay__ .pk-filter-tag-area .pk-tag-group-title {
          margin-top: 0;
        }
        #__pagekeep_overlay__ .pk-count-row {
          font-size: 12px; color: #666;
          margin-bottom: 8px;
        }
        #__pagekeep_overlay__ .pk-card-list {
          display: flex; flex-direction: column; gap: 8px;
        }
        #__pagekeep_overlay__ .pk-card {
          background: #fff; border: 1px solid #e0e0e0;
          border-radius: 8px; padding: 12px;
          cursor: pointer; transition: border-color 0.15s;
        }
        #__pagekeep_overlay__ .pk-card:hover {
          border-color: #0066cc;
        }
        #__pagekeep_overlay__ .pk-card-title {
          font-size: 15px; font-weight: 600;
          margin-bottom: 4px; line-height: 1.3;
        }
        #__pagekeep_overlay__ .pk-card-links {
          font-size: 12px; margin-bottom: 6px;
        }
        #__pagekeep_overlay__ .pk-card-links a {
          color: #0066cc; text-decoration: none; margin-right: 12px;
        }
        #__pagekeep_overlay__ .pk-card-links a:hover {
          text-decoration: underline;
        }
        #__pagekeep_overlay__ .pk-card-tags {
          margin-bottom: 6px;
        }
        #__pagekeep_overlay__ .pk-card-excerpt {
          font-size: 13px; color: #555;
          margin-bottom: 4px; line-height: 1.4;
          display: -webkit-box;
          -webkit-line-clamp: 3;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        #__pagekeep_overlay__ .pk-card-note {
          font-size: 13px; color: #444;
          margin-bottom: 4px;
          font-style: italic;
        }
        #__pagekeep_overlay__ .pk-card-meta {
          font-size: 11px; color: #999;
        }
        #__pagekeep_overlay__ .pk-empty {
          text-align: center; padding: 40px 16px;
          color: #999;
        }
        
        /* === 削除確認モーダル === */
        #__pagekeep_overlay__ .pk-confirm-overlay {
          position: absolute; inset: 0;
          background: rgba(0,0,0,0.5);
          display: flex; align-items: center; justify-content: center;
          z-index: 10;
        }
        #__pagekeep_overlay__ .pk-confirm-box {
          background: #fff; border-radius: 12px;
          padding: 24px; width: min(360px, 88%);
          box-shadow: 0 12px 40px rgba(0,0,0,0.3);
        }
        #__pagekeep_overlay__ .pk-confirm-title {
          font-size: 16px; font-weight: 600;
          margin-bottom: 8px;
        }
        #__pagekeep_overlay__ .pk-confirm-msg {
          font-size: 14px; color: #555;
          margin-bottom: 16px; line-height: 1.5;
        }
        #__pagekeep_overlay__ .pk-confirm-actions {
          display: flex; gap: 8px; justify-content: flex-end;
        }
        
        @media (prefers-color-scheme: dark) {
          #__pagekeep_overlay__ { color: #e0e0e0; }
          #__pagekeep_overlay__ .pk-modal { background: #2a2a2a; }
          #__pagekeep_overlay__ input,
          #__pagekeep_overlay__ select,
          #__pagekeep_overlay__ textarea {
            background: #1a1a1a; color: #e0e0e0; border-color: #444;
          }
          #__pagekeep_overlay__ button.pk-btn {
            background: #2a2a2a; color: #e0e0e0; border-color: #444;
          }
          #__pagekeep_overlay__ .pk-tag-chip { background: #444; color: #e0e0e0; }
          #__pagekeep_overlay__ .pk-selected-tags { background: #1a1a1a; }
          #__pagekeep_overlay__ .pk-radio-label,
          #__pagekeep_overlay__ .pk-checkbox-label {
            background: #1a1a1a; color: #e0e0e0; border-color: #444;
          }
          #__pagekeep_overlay__ .pk-tag-add-btn {
            background: #333; color: #ccc; border-color: #555;
          }
          #__pagekeep_overlay__ .pk-mode-btn {
            background: #333; color: #ccc; border-color: #555;
          }
          #__pagekeep_overlay__ .pk-card {
            background: #2a2a2a; border-color: #444;
          }
          #__pagekeep_overlay__ .pk-card-excerpt { color: #aaa; }
          #__pagekeep_overlay__ .pk-card-note { color: #bbb; }
          #__pagekeep_overlay__ .pk-filter-tag-area { background: #1a1a1a; }
          #__pagekeep_overlay__ .pk-confirm-box { background: #2a2a2a; }
        }
      </style>
      <div class="pk-modal">
        <div class="pk-header">
          <h2>📌 PageKeep</h2>
          <div class="pk-header-actions">
            <button class="pk-close">×</button>
          </div>
        </div>
        <div class="pk-body">読み込み中...</div>
      </div>
    `);
    document.body.appendChild(overlay);
    overlay.querySelector('.pk-close').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    return overlay;
  }
  
  // ============================================
  // 共通：タグ管理UI
  // ============================================
  function setupTagUI(body, allTags, initialTags) {
    let selectedTags = [...initialTags];
    
    const recentTags = [...allTags]
      .filter(t => t.lastUsed)
      .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))
      .slice(0, 8);
    
    const popularTags = [...allTags]
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
    
    function renderSelected() {
      const el = body.querySelector('#pk-selected');
      if (!el) return;
      setHTML(el, selectedTags.map((t, i) => 
        `<span class="pk-tag-chip selected" data-idx="${i}">${escapeAttr(t)}<span class="pk-remove">×</span></span>`
      ).join(''));
      el.querySelectorAll('.pk-tag-chip').forEach(chip => {
        chip.onclick = () => {
          selectedTags.splice(parseInt(chip.dataset.idx), 1);
          renderSelected();
          updateSuggestionHighlights();
        };
      });
    }
    
    function updateSuggestionHighlights() {
      body.querySelectorAll('#pk-tag-suggestions .pk-tag-chip').forEach(chip => {
        chip.classList.toggle('selected', selectedTags.includes(chip.dataset.tag));
      });
    }
    
    function addTag(fullTag) {
      const trimmed = fullTag.trim();
      if (!trimmed) return false;
      if (selectedTags.includes(trimmed)) return false;
      
      const similar = findSimilarTags(trimmed, allTags.map(t => t.name));
      if (similar.length > 0) {
        const warningEl = body.querySelector('#pk-tag-warning');
        if (!warningEl) return false;
        warningEl.style.display = 'block';
        setHTML(warningEl, 
          `⚠ 似たタグがあります: ${similar.map(s => 
            `<span class="pk-tag-chip" data-similar="${escapeAttr(s)}">${escapeAttr(s)}</span>`
          ).join(' ')} <a href="#" id="pk-force-add" style="color:#0066cc;">このまま追加</a>`
        );
        warningEl.querySelectorAll('[data-similar]').forEach(el => {
          el.onclick = () => {
            selectedTags.push(el.dataset.similar);
            renderSelected();
            updateSuggestionHighlights();
            warningEl.style.display = 'none';
            const input = body.querySelector('#pk-tag-name');
            if (input) input.value = '';
          };
        });
        warningEl.querySelector('#pk-force-add').onclick = (e) => {
          e.preventDefault();
          selectedTags.push(trimmed);
          renderSelected();
          updateSuggestionHighlights();
          warningEl.style.display = 'none';
          const input = body.querySelector('#pk-tag-name');
          if (input) input.value = '';
        };
        return false;
      }
      
      selectedTags.push(trimmed);
      renderSelected();
      updateSuggestionHighlights();
      return true;
    }
    
    function renderTagSuggestions(recent, popular) {
      const el = body.querySelector('#pk-tag-suggestions');
      if (!el) return;
      setHTML(el, `
        ${recent.length > 0 ? `
          <div class="pk-tag-group-title">最近使った</div>
          <div>${recent.map(t => `<span class="pk-tag-chip" data-tag="${escapeAttr(t.name)}">${escapeAttr(t.name)}</span>`).join('')}</div>
        ` : ''}
        ${popular.length > 0 ? `
          <div class="pk-tag-group-title">よく使う</div>
          <div>${popular.map(t => `<span class="pk-tag-chip" data-tag="${escapeAttr(t.name)}">${escapeAttr(t.name)} (${t.count})</span>`).join('')}</div>
        ` : ''}
      `);
      attachSuggestionClicks();
      updateSuggestionHighlights();
    }
    
    function renderFilteredSuggestions(filtered) {
      const el = body.querySelector('#pk-tag-suggestions');
      if (!el) return;
      if (filtered.length === 0) {
        setHTML(el, `<div class="pk-tag-group-title">該当タグなし（新規作成されます）</div>`);
        return;
      }
      setHTML(el, `
        <div class="pk-tag-group-title">検索結果</div>
        <div>${filtered.map(t => `<span class="pk-tag-chip" data-tag="${escapeAttr(t.name)}">${escapeAttr(t.name)} (${t.count})</span>`).join('')}</div>
      `);
      attachSuggestionClicks();
      updateSuggestionHighlights();
    }
    
    function attachSuggestionClicks() {
      body.querySelectorAll('#pk-tag-suggestions .pk-tag-chip').forEach(chip => {
        chip.onclick = () => {
          const tag = chip.dataset.tag;
          if (selectedTags.includes(tag)) {
            selectedTags = selectedTags.filter(t => t !== tag);
          } else {
            selectedTags.push(tag);
          }
          renderSelected();
          updateSuggestionHighlights();
        };
      });
    }
    
    const addBtn = body.querySelector('#pk-tag-add');
    if (addBtn) {
      addBtn.onclick = (e) => {
        e.preventDefault();
        const prefix = body.querySelector('#pk-prefix').value;
        const name = body.querySelector('#pk-tag-name').value.trim();
        if (!name) return;
        const fullTag = prefix ? `${prefix}/${name}` : name;
        if (addTag(fullTag)) {
          body.querySelector('#pk-tag-name').value = '';
          body.querySelector('#pk-tag-warning').style.display = 'none';
        }
      };
    }
    
    const tagNameInput = body.querySelector('#pk-tag-name');
    if (tagNameInput) {
      tagNameInput.onkeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          addBtn.click();
        }
      };
      tagNameInput.oninput = (e) => {
        const q = e.target.value.toLowerCase().normalize('NFKC');
        if (!q) {
          renderTagSuggestions(recentTags, popularTags);
          return;
        }
        const filtered = allTags.filter(t => 
          t.name.toLowerCase().normalize('NFKC').includes(q)
        ).slice(0, 20);
        renderFilteredSuggestions(filtered);
      };
    }
    
    renderTagSuggestions(recentTags, popularTags);
    renderSelected();
    
    return {
      getSelected: () => selectedTags,
      autoAddPending: () => {
        const input = body.querySelector('#pk-tag-name');
        if (!input) return;
        const pendingTagName = input.value.trim();
        if (!pendingTagName) return;
        const prefix = body.querySelector('#pk-prefix').value;
        const fullTag = prefix ? `${prefix}/${pendingTagName}` : pendingTagName;
        const similar = findSimilarTags(fullTag, allTags.map(t => t.name));
        if (similar.length > 0) {
          if (!selectedTags.includes(similar[0])) selectedTags.push(similar[0]);
        } else if (!selectedTags.includes(fullTag)) {
          selectedTags.push(fullTag);
        }
        input.value = '';
      },
    };
  }
  
  // ============================================
  // 共通：ラジオ・チェック見た目更新
  // ============================================
  function setupStatusFlagUI(body) {
    body.querySelectorAll('input[name="pk-status"]').forEach(input => {
      input.onchange = () => {
        body.querySelectorAll('.pk-radio-label').forEach(l => l.classList.remove('checked'));
        if (input.checked) input.parentElement.classList.add('checked');
      };
    });
    body.querySelectorAll('input[name="pk-flag"]').forEach(input => {
      input.onchange = () => {
        input.parentElement.classList.toggle('checked', input.checked);
      };
    });
  }

 　// ============================================
  // 保存・更新フォーム
  // ============================================
  function renderForm(overlay, pageData, existing, fromListView) {
    const body = overlay.querySelector('.pk-body');
    const headerActions = overlay.querySelector('.pk-header-actions');
    const isUpdate = existing.exists;
    
    // ヘッダーに「📚 一覧」ボタン or 「← 戻る」ボタン
    setHTML(headerActions, fromListView
      ? `<button class="pk-mode-btn" id="pk-back-to-list">← 戻る</button>
         <button class="pk-close">×</button>`
      : `<button class="pk-mode-btn" id="pk-show-list">📚 一覧</button>
         <button class="pk-close">×</button>`
    );
    overlay.querySelector('.pk-close').onclick = () => overlay.remove();
    
    if (fromListView) {
      overlay.querySelector('#pk-back-to-list').onclick = async () => {
        await reloadAndShowList(overlay);
      };
    } else {
      overlay.querySelector('#pk-show-list').onclick = async () => {
        await reloadAndShowList(overlay);
      };
    }
    
    const statusBanner = isUpdate
      ? `<div class="pk-status-banner existing">
           ⚠ 既に保存済み（${existing.updateCount || 0}回更新済み）
           ${existing.docUrl ? `<br><a href="${escapeAttr(existing.docUrl)}" target="_blank">📄 既存のDocを開く</a>` : ''}
         </div>`
      : `<div class="pk-status-banner new">✓ 新規ページとして保存します</div>`;
    
    const initialStatus = existing.status || '';
    const initialFlags = existing.flags || [];
    const initialTags = existing.tags || [];
    const initialNote = isUpdate ? (existing.note || '') : '';
    const titleValue = isUpdate ? (existing.title || pageData.title) : pageData.title;
    const excerptValue = isUpdate ? (existing.excerpt !== undefined ? existing.excerpt : pageData.excerpt) : pageData.excerpt;
    
    const prefixOptions = state.prefixes.map(p => 
      `<option value="${escapeAttr(p.name)}">${escapeAttr(p.name)} (${p.count})</option>`
    ).join('');
    
    const submitLabel = isUpdate ? '更新' : '保存';
    const submitClass = isUpdate ? 'pk-btn-update' : 'pk-btn-primary';
    
    setHTML(body, `
      ${statusBanner}
      
      <label class="required">タイトル</label>
      <input type="text" id="pk-title" value="${escapeAttr(titleValue)}">
      
      <label class="required">ステータス</label>
      <div class="pk-radio-group">
        ${STATUSES.map(s => `
          <label class="pk-radio-label ${initialStatus === s.value ? 'checked' : ''}">
            <input type="radio" name="pk-status" value="${s.value}" ${initialStatus === s.value ? 'checked' : ''}>
            ${s.label}
          </label>
        `).join('')}
      </div>
      
      <label>フラグ</label>
      <div class="pk-checkbox-group">
        ${FLAGS.map(f => `
          <label class="pk-checkbox-label ${initialFlags.includes(f.value) ? 'checked' : ''}">
            <input type="checkbox" name="pk-flag" value="${f.value}" ${initialFlags.includes(f.value) ? 'checked' : ''}>
            ${f.label}
          </label>
        `).join('')}
      </div>
      
      <label>タグ</label>
      <div class="pk-tag-input-row">
        <select id="pk-prefix">
          <option value="">プレフィックスなし</option>
          ${prefixOptions}
        </select>
        <input type="text" id="pk-tag-name" placeholder="タグを入力（保存時に自動追加）">
        <button class="pk-tag-add-btn" id="pk-tag-add">+</button>
      </div>
      <div class="pk-warning" id="pk-tag-warning" style="display:none;"></div>
      
      <div class="pk-selected-tags" id="pk-selected"></div>
      <div class="pk-tag-area" id="pk-tag-suggestions"></div>
      
      <label>抜粋</label>
      <textarea id="pk-excerpt">${escapeText(excerptValue)}</textarea>
      
      <label>メモ</label>
      <textarea id="pk-note" placeholder="一言コメント">${escapeText(initialNote)}</textarea>
      
      <div class="pk-actions">
        <div>
          ${isUpdate ? `<button class="pk-btn pk-btn-danger pk-delete">🗑 削除</button>` : ''}
        </div>
        <div class="pk-actions-right">
          <button class="pk-btn pk-cancel">キャンセル</button>
          <button class="pk-btn ${submitClass} pk-submit">${submitLabel}</button>
        </div>
      </div>
    `);
    
    const tagUI = setupTagUI(body, state.allTags, initialTags);
    setupStatusFlagUI(body);
    
    body.querySelector('.pk-cancel').onclick = async () => {
      if (fromListView) {
        await reloadAndShowList(overlay);
      } else {
        overlay.remove();
      }
    };
    
    // 削除ボタン
    const deleteBtn = body.querySelector('.pk-delete');
    if (deleteBtn) {
      deleteBtn.onclick = () => {
        showDeleteConfirm(overlay, existing, async () => {
          const result = await callGas('delete', {
            id: existing.id,
            normalizedUrl: pageData.normalizedUrl,
          });
          if (result.success) {
            if (fromListView) {
              await reloadAndShowList(overlay);
            } else {
              setHTML(body, `<div class="pk-success"><p>🗑 削除しました</p></div>`);
              setTimeout(() => overlay.remove(), 1500);
            }
          } else {
            alert('削除失敗: ' + (result.error || 'unknown'));
          }
        });
      };
    }
    
    // 保存/更新
    body.querySelector('.pk-submit').onclick = async () => {
      const statusInput = body.querySelector('input[name="pk-status"]:checked');
      if (!statusInput) {
        alert('ステータスを選択してください');
        return;
      }
      
      tagUI.autoAddPending();
      
      const btn = body.querySelector('.pk-submit');
      btn.disabled = true;
      btn.textContent = isUpdate ? '更新中...' : '保存中...';
      
      const flagsChecked = Array.from(body.querySelectorAll('input[name="pk-flag"]:checked')).map(c => c.value);
      
      const action = isUpdate ? 'update' : 'save';
      const result = await callGas(action, {
        id: existing.id,
        url: pageData.url,
        normalizedUrl: pageData.normalizedUrl,
        title: body.querySelector('#pk-title').value,
        excerpt: body.querySelector('#pk-excerpt').value,
        note: body.querySelector('#pk-note').value,
        tags: tagUI.getSelected(),
        status: statusInput.value,
        flags: flagsChecked,
      });
      
     if (result.success) {
        if (fromListView) {
          await reloadAndShowList(overlay);
        } else {
          const docUrl = result.docUrl || existing.docUrl;
          setHTML(body, `
            <div class="pk-success">
              <p>${isUpdate ? '✅ 更新しました' : '✅ 保存しました'}</p>
              ${docUrl ? `<p><a href="${escapeAttr(docUrl)}" target="_blank">📄 Docを開く</a></p>` : ''}
            </div>
          `);
          
          // 自動クローズタイマー
          const closeTimer = setTimeout(() => overlay.remove(), 2000);
          
          // ヘッダーの「一覧」ボタンを押されたらタイマーキャンセルして一覧へ
          const showListBtn = overlay.querySelector('#pk-show-list');
          if (showListBtn) {
            showListBtn.onclick = async () => {
              clearTimeout(closeTimer);
              await reloadAndShowList(overlay);
            };
          }
          
          // 「×」もタイマーキャンセル（押した瞬間に閉じる、ダブル発火防止）
          const closeBtn = overlay.querySelector('.pk-close');
          if (closeBtn) {
            closeBtn.onclick = () => {
              clearTimeout(closeTimer);
              overlay.remove();
            };
          }
        }
      } else {
        const banner = body.querySelector('.pk-status-banner');
        banner.className = 'pk-status-banner error';
        banner.textContent = '❌ エラー: ' + (result.error || 'unknown');
        btn.disabled = false;
        btn.textContent = submitLabel;
      }
    };
  }
  
  // ============================================
  // 削除確認モーダル
  // ============================================
  function showDeleteConfirm(overlay, existing, onConfirm) {
    const modal = overlay.querySelector('.pk-modal');
    const confirmEl = document.createElement('div');
    confirmEl.className = 'pk-confirm-overlay';
    setHTML(confirmEl, `
      <div class="pk-confirm-box">
        <div class="pk-confirm-title">🗑 削除しますか？</div>
        <div class="pk-confirm-msg">
          「${escapeText(truncate(existing.title || '無題', 40))}」を削除します。<br>
          Sheetsの行とGoogle Docがゴミ箱に移動します（30日復元可能）。
        </div>
        <div class="pk-confirm-actions">
          <button class="pk-btn pk-cancel-delete">キャンセル</button>
          <button class="pk-btn pk-btn-danger pk-confirm-delete">削除する</button>
        </div>
      </div>
    `);
    modal.appendChild(confirmEl);
    confirmEl.querySelector('.pk-cancel-delete').onclick = () => confirmEl.remove();
    confirmEl.querySelector('.pk-confirm-delete').onclick = async () => {
      confirmEl.remove();
      await onConfirm();
    };
  }
  
  // ============================================
  // 閲覧画面
  // ============================================
  function renderListView(overlay) {
    const modal = overlay.querySelector('.pk-modal');
    modal.classList.add('pk-modal-list');
    
    const body = overlay.querySelector('.pk-body');
    const headerActions = overlay.querySelector('.pk-header-actions');
    
    // ヘッダー：戻る or ×
    setHTML(headerActions, `
      <button class="pk-mode-btn" id="pk-back-to-save">💾 保存画面へ</button>
      <button class="pk-close">×</button>
    `);
    overlay.querySelector('.pk-close').onclick = () => {
      modal.classList.remove('pk-modal-list');
      overlay.remove();
    };
    overlay.querySelector('#pk-back-to-save').onclick = () => {
      modal.classList.remove('pk-modal-list');
      renderForm(overlay, state.pageData, state.existing, false);
    };
    
    const prefixOptions = state.prefixes.map(p => 
      `<option value="${escapeAttr(p.name)}">${escapeAttr(p.name)}</option>`
    ).join('');
    
    setHTML(body, `
      <div class="pk-list-search">
        <input type="text" id="pk-search" placeholder="🔍 キーワード検索（タイトル・抜粋・メモ・タグ）">
      </div>
      
      <div class="pk-filter-row">
        <select id="pk-filter-status">
          <option value="not-archive">アーカイブ除く</option>
          ${STATUSES.map(s => `<option value="${s.value}">${s.label}</option>`).join('')}
          <option value="">すべて（アーカイブも含む）</option>
        </select>
        <select id="pk-filter-flag">
          <option value="">フラグ: 全て</option>
          ${FLAGS.map(f => `<option value="${f.value}">${f.label}</option>`).join('')}
        </select>
        <select id="pk-filter-prefix">
          <option value="">プレフィックス: 全て</option>
          ${prefixOptions}
        </select>
        <select id="pk-sort">
          <option value="updated">更新日新しい順</option>
          <option value="saved">保存日新しい順</option>
          <option value="title">タイトル順</option>
        </select>
      </div>
      
      <div class="pk-filter-tag-area">
        <div class="pk-tag-group-title">タグで絞り込み（複数選択可、AND）</div>
        <div id="pk-filter-tag-chips"></div>
        <div id="pk-filter-selected-tags" style="margin-top: 6px;"></div>
      </div>
      
      <div class="pk-count-row" id="pk-count"></div>
      <div class="pk-card-list" id="pk-cards"></div>
    `);
    
   // フィルタ状態
    const filter = {
      keyword: '',
      status: 'not-archive',  // デフォルトでアーカイブ除外
      flag: '',
      prefix: '',
      tags: [],
      sort: 'updated',
    };
    
    // タグチップ（プレフィックスでフィルタされて表示）
    function renderFilterTagChips() {
      const el = body.querySelector('#pk-filter-tag-chips');
      let tagList = state.allTags;
      if (filter.prefix) {
        tagList = tagList.filter(t => t.prefix === filter.prefix);
      }
      tagList = [...tagList].sort((a, b) => b.count - a.count).slice(0, 30);
      
      setHTML(el, tagList.map(t => 
        `<span class="pk-tag-chip ${filter.tags.includes(t.name) ? 'selected' : ''}" data-tag="${escapeAttr(t.name)}">${escapeAttr(t.name)} (${t.count})</span>`
      ).join(''));
      
      el.querySelectorAll('.pk-tag-chip').forEach(chip => {
        chip.onclick = () => {
          const tag = chip.dataset.tag;
          if (filter.tags.includes(tag)) {
            filter.tags = filter.tags.filter(t => t !== tag);
          } else {
            filter.tags.push(tag);
          }
          renderFilterTagChips();
          renderSelectedFilterTags();
          renderCards();
        };
      });
    }
    
    function renderSelectedFilterTags() {
      const el = body.querySelector('#pk-filter-selected-tags');
      if (filter.tags.length === 0) {
        setHTML(el, '');
        return;
      }
      setHTML(el, `
        <span style="font-size:11px;color:#999;margin-right:6px;">選択中:</span>
        ${filter.tags.map(t => 
          `<span class="pk-tag-chip selected" data-clear="${escapeAttr(t)}">${escapeAttr(t)}<span class="pk-remove">×</span></span>`
        ).join('')}
      `);
      el.querySelectorAll('[data-clear]').forEach(chip => {
        chip.onclick = () => {
          filter.tags = filter.tags.filter(t => t !== chip.dataset.clear);
          renderFilterTagChips();
          renderSelectedFilterTags();
          renderCards();
        };
      });
    }
    
    // カード一覧
    function renderCards() {
      const filtered = applyFilter(state.allPages, filter);
      const sorted = applySort(filtered, filter.sort);
      
      const countEl = body.querySelector('#pk-count');
      countEl.textContent = `📊 ${sorted.length}件 / 全${state.allPages.length}件`;
      
      const el = body.querySelector('#pk-cards');
      if (sorted.length === 0) {
        setHTML(el, `<div class="pk-empty">該当するページがありません</div>`);
        return;
      }
      
      setHTML(el, sorted.map(p => renderCard(p)).join(''));
      
      el.querySelectorAll('.pk-card').forEach(card => {
        card.onclick = (e) => {
          // リンククリックは詳細を開かない
          if (e.target.tagName === 'A') return;
          const id = card.dataset.id;
          const page = state.allPages.find(p => p.id === id);
          if (page) openDetail(page);
        };
      });
    }
    
    function renderCard(p) {
      const statusEmoji = (statusLabel(p.status).match(/^\S+/) || [''])[0];
      const flagStr = (p.flags || []).map(flagLabel).map(s => (s.match(/^\S+/) || [''])[0]).join(' ');
      const tagsHtml = (p.tags || []).map(t => 
        `<span class="pk-tag-chip">${escapeAttr(t)}</span>`
      ).join('');
      const updatedStr = p.updatedAt ? formatDateShort(p.updatedAt) : '';
      const savedStr = p.savedAt ? formatDateShort(p.savedAt) : '';
      const updateCountStr = p.updateCount > 0 ? ` (${p.updateCount}回更新)` : '';
      
      return `
        <div class="pk-card" data-id="${escapeAttr(p.id)}">
          <div class="pk-card-title">${statusEmoji} ${escapeText(p.title || '無題')} ${flagStr}</div>
          <div class="pk-card-links">
            ${p.url ? `<a href="${escapeAttr(p.url)}" target="_blank">🔗 元ページ</a>` : ''}
            ${p.docUrl ? `<a href="${escapeAttr(p.docUrl)}" target="_blank">📄 Doc</a>` : ''}
          </div>
          ${tagsHtml ? `<div class="pk-card-tags">${tagsHtml}</div>` : ''}
          ${p.excerpt ? `<div class="pk-card-excerpt">${escapeText(p.excerpt)}</div>` : ''}
          ${p.note ? `<div class="pk-card-note">📝 ${escapeText(p.note)}</div>` : ''}
          <div class="pk-card-meta">保存: ${savedStr} / 更新: ${updatedStr}${updateCountStr}</div>
        </div>
      `;
    }
    
    function openDetail(page) {
      modal.classList.remove('pk-modal-list');
      const existingData = {
        exists: true,
        id: page.id,
        savedAt: page.savedAt,
        title: page.title,
        docUrl: page.docUrl,
        tags: page.tags,
        note: page.note,
        excerpt: page.excerpt,
        updateCount: page.updateCount,
        status: page.status,
        flags: page.flags,
      };
      const pageDataForEdit = {
        url: page.url,
        normalizedUrl: page.normalizedUrl,
        title: page.title,
        excerpt: page.excerpt,
      };
      renderForm(overlay, pageDataForEdit, existingData, true);
    }
    
    // イベント
    body.querySelector('#pk-search').oninput = (e) => {
      filter.keyword = e.target.value;
      renderCards();
    };
    body.querySelector('#pk-filter-status').onchange = (e) => {
      filter.status = e.target.value;
      renderCards();
    };
    body.querySelector('#pk-filter-flag').onchange = (e) => {
      filter.flag = e.target.value;
      renderCards();
    };
    body.querySelector('#pk-filter-prefix').onchange = (e) => {
      filter.prefix = e.target.value;
      filter.tags = []; // プレフィックス変更時はタグ選択をリセット
      renderFilterTagChips();
      renderSelectedFilterTags();
      renderCards();
    };
    body.querySelector('#pk-sort').onchange = (e) => {
      filter.sort = e.target.value;
      renderCards();
    };
    
    renderFilterTagChips();
    renderSelectedFilterTags();
    renderCards();
  }
  
  // ============================================
  // フィルタロジック
  // ============================================
 function applyFilter(pages, filter) {
    const kw = filter.keyword ? normalizeForCompare(filter.keyword) : '';
    
    return pages.filter(p => {
      if (filter.status === 'not-archive') {
        if (p.status === 'archive') return false;
      } else if (filter.status && p.status !== filter.status) {
        return false;
      }
      if (filter.flag && !(p.flags || []).includes(filter.flag)) return false;
      if (filter.prefix) {
        const hasPrefix = (p.tags || []).some(t => t.startsWith(filter.prefix + '/'));
        if (!hasPrefix) return false;
      }
      if (filter.tags && filter.tags.length > 0) {
        for (const t of filter.tags) {
          if (!(p.tags || []).includes(t)) return false;
        }
      }
      if (kw) {
        const target = normalizeForCompare(
          (p.title || '') + ' ' +
          (p.excerpt || '') + ' ' +
          (p.note || '') + ' ' +
          (p.tags || []).join(' ')
        );
        if (!target.includes(kw)) return false;
      }
      return true;
    });
  }
  
  function applySort(pages, sortKey) {
    const arr = [...pages];
    if (sortKey === 'updated') {
      arr.sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0));
    } else if (sortKey === 'saved') {
      arr.sort((a, b) => new Date(b.savedAt || 0) - new Date(a.savedAt || 0));
    } else if (sortKey === 'title') {
      arr.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ja'));
    }
    return arr;
  }
  
  // ============================================
  // 一覧をリロードして表示
  // ============================================
  async function reloadAndShowList(overlay) {
    const body = overlay.querySelector('.pk-body');
    setHTML(body, '<div class="pk-empty">読み込み中...</div>');
    
    const [pagesRes, tagsRes, prefixesRes] = await Promise.all([
      callGas('getAllPages', {}),
      callGas('getTags', {}),
      callGas('getPrefixes', {}),
    ]);
    
    state.allPages = pagesRes.pages || [];
    state.allTags = tagsRes.tags || [];
    state.prefixes = prefixesRes.prefixes || [];
    
    renderListView(overlay);
  }
  
  // ============================================
  // メイン
  // ============================================
  const overlay = buildOverlay();
  const pageData = collectPageData();
  state.pageData = pageData;
  
  try {
    const versionRes = await callGas('version', {});
    if (versionRes.version < REQUIRED_GAS_VERSION) {
      setHTML(overlay.querySelector('.pk-body'), `
        <div class="pk-status-banner error">
          GASの更新が必要です（現在: v${versionRes.version} / 必要: v${REQUIRED_GAS_VERSION}）<br>
          最新のGASコードを script.google.com で貼り直してください。
        </div>
      `);
      return;
    }
    
    const [existing, prefixesRes, tagsRes] = await Promise.all([
      callGas('check', {
        url: pageData.url,
        normalizedUrl: pageData.normalizedUrl,
      }),
      callGas('getPrefixes', {}),
      callGas('getTags', {}),
    ]);
    
    state.existing = existing;
    state.prefixes = prefixesRes.prefixes || [];
    state.allTags = tagsRes.tags || [];
    
    renderForm(overlay, pageData, existing, false);
  } catch (err) {
    setHTML(overlay.querySelector('.pk-body'), `
      <div class="pk-status-banner error">通信エラー: ${err.message}</div>
    `);
  }
})();
