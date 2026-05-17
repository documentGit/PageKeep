// ============================================
// PageKeep - Client Script (v2)
// ============================================
(async function() {
  'use strict';
  
  const REQUIRED_GAS_VERSION = 2;
  
  // Trusted Types 対応
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
  
  const existing = document.getElementById('__pagekeep_overlay__');
  if (existing) existing.remove();
  
  // ============================================
  // ステータス・フラグ定義
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
    const title = (
      document.querySelector('meta[property="og:title"]')?.content ||
      document.title || ''
    ).trim();
    let excerpt = window.getSelection().toString().trim();
    if (!excerpt) {
      excerpt = (
        document.querySelector('meta[property="og:description"]')?.content ||
        document.querySelector('meta[name="description"]')?.content || ''
      ).trim();
    }
    return { url, normalizedUrl, title, excerpt };
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
  // 表記ゆれチェック
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
  
  // ============================================
  // UI構築
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
          width: min(520px, 94%); max-height: 90vh;
          overflow-y: auto; padding: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        #__pagekeep_overlay__ .pk-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 12px;
        }
        #__pagekeep_overlay__ h2 { margin: 0; font-size: 18px; }
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
        #__pagekeep_overlay__ .pk-tag-input-row {
          display: flex; gap: 6px;
        }
        #__pagekeep_overlay__ .pk-tag-input-row select {
          flex: 0 0 35%;
        }
        #__pagekeep_overlay__ .pk-tag-input-row input {
          flex: 1;
        }
        #__pagekeep_overlay__ .pk-tag-add-btn {
          flex: 0 0 auto; padding: 0 14px;
          border: 1px solid #0066cc; background: #0066cc; color: #fff;
          border-radius: 6px; cursor: pointer; font-size: 18px;
        }
        #__pagekeep_overlay__ .pk-tag-area {
          margin-top: 8px;
        }
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
          display: flex; gap: 8px; justify-content: flex-end;
          margin-top: 16px;
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
        #__pagekeep_overlay__ .pk-success {
          text-align: center; padding: 24px 12px;
        }
        #__pagekeep_overlay__ .pk-success a {
          color: #0066cc; text-decoration: none;
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
        }
      </style>
      <div class="pk-modal">
        <div class="pk-header">
          <h2>📌 PageKeep</h2>
          <button class="pk-close">×</button>
        </div>
        <div class="pk-body">読み込み中...</div>
      </div>
    `);
    document.body.appendChild(overlay);
    overlay.querySelector('.pk-close').onclick = () => overlay.remove();
    overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
    return overlay;
  }
  
  function escapeAttr(s) {
    return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeText(s) {
    return String(s || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  
  function renderForm(overlay, pageData, existing, prefixes, allTags) {
    const body = overlay.querySelector('.pk-body');
    
    const statusBanner = existing.exists
      ? `<div class="pk-status-banner existing">⚠ 既に保存済み（${(existing.updateCount || 0) + 1}回目）</div>`
      : `<div class="pk-status-banner new">✓ 新規ページとして保存します</div>`;
    
    const initialStatus = existing.status || '';
    const initialFlags = existing.flags || [];
    const initialTags = existing.tags || [];
    
    // プレフィックスのドロップダウン
    const prefixOptions = prefixes.map(p => 
      `<option value="${escapeAttr(p.name)}">${escapeAttr(p.name)} (${p.count})</option>`
    ).join('');
    
    // 最近使ったタグ（上位8件）
    const recentTags = [...allTags]
      .filter(t => t.lastUsed)
      .sort((a, b) => new Date(b.lastUsed) - new Date(a.lastUsed))
      .slice(0, 8);
    
    // よく使うタグ（上位12件）
    const popularTags = [...allTags]
      .sort((a, b) => b.count - a.count)
      .slice(0, 12);
    
    setHTML(body, `
      ${statusBanner}
      
      <label class="required">タイトル</label>
      <input type="text" id="pk-title" value="${escapeAttr(pageData.title)}">
      
      <label class="required">ステータス</label>
      <div class="pk-radio-group" id="pk-status-group">
        ${STATUSES.map(s => `
          <label class="pk-radio-label ${initialStatus === s.value ? 'checked' : ''}">
            <input type="radio" name="pk-status" value="${s.value}" ${initialStatus === s.value ? 'checked' : ''}>
            ${s.label}
          </label>
        `).join('')}
      </div>
      
      <label>フラグ</label>
      <div class="pk-checkbox-group" id="pk-flags-group">
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
        <input type="text" id="pk-tag-name" placeholder="タグ名 or 検索">
        <button class="pk-tag-add-btn" id="pk-tag-add">+</button>
      </div>
      <div class="pk-warning" id="pk-tag-warning" style="display:none;"></div>
      
      <div class="pk-selected-tags" id="pk-selected"></div>
      
      <div class="pk-tag-area" id="pk-tag-suggestions">
        ${recentTags.length > 0 ? `
          <div class="pk-tag-group-title">最近使った</div>
          <div>${recentTags.map(t => `<span class="pk-tag-chip" data-tag="${escapeAttr(t.name)}">${escapeAttr(t.name)}</span>`).join('')}</div>
        ` : ''}
        ${popularTags.length > 0 ? `
          <div class="pk-tag-group-title">よく使う</div>
          <div>${popularTags.map(t => `<span class="pk-tag-chip" data-tag="${escapeAttr(t.name)}">${escapeAttr(t.name)} (${t.count})</span>`).join('')}</div>
        ` : ''}
      </div>
      
      <label>抜粋</label>
      <textarea id="pk-excerpt">${escapeText(pageData.excerpt)}</textarea>
      
      <label>メモ</label>
      <textarea id="pk-note" placeholder="一言コメント"></textarea>
      
      <div class="pk-actions">
        <button class="pk-btn pk-cancel">キャンセル</button>
        <button class="pk-btn pk-btn-primary pk-submit">保存</button>
      </div>
    `);
    
    // 選択中タグの管理
    let selectedTags = [...initialTags];
    
    function renderSelected() {
      const el = body.querySelector('#pk-selected');
      setHTML(el, selectedTags.map((t, i) => 
        `<span class="pk-tag-chip selected" data-idx="${i}">${escapeAttr(t)}<span class="pk-remove">×</span></span>`
      ).join(''));
      el.querySelectorAll('.pk-tag-chip').forEach(chip => {
        chip.onclick = () => {
          const idx = parseInt(chip.dataset.idx);
          selectedTags.splice(idx, 1);
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
    
    // タグ追加処理
    function addTag(fullTag) {
      const trimmed = fullTag.trim();
      if (!trimmed) return false;
      if (selectedTags.includes(trimmed)) return false;
      
      // 表記ゆれチェック
      const similar = findSimilarTags(trimmed, allTags.map(t => t.name));
      if (similar.length > 0) {
        const warningEl = body.querySelector('#pk-tag-warning');
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
            body.querySelector('#pk-tag-name').value = '';
          };
        });
        warningEl.querySelector('#pk-force-add').onclick = (e) => {
          e.preventDefault();
          selectedTags.push(trimmed);
          renderSelected();
          updateSuggestionHighlights();
          warningEl.style.display = 'none';
          body.querySelector('#pk-tag-name').value = '';
        };
        return false;
      }
      
      selectedTags.push(trimmed);
      renderSelected();
      updateSuggestionHighlights();
      return true;
    }
    
    // タグ追加ボタン
    body.querySelector('#pk-tag-add').onclick = (e) => {
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
    
    // Enter キーでも追加
    body.querySelector('#pk-tag-name').onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        body.querySelector('#pk-tag-add').click();
      }
    };
    
    // タグサジェスト：インクリメンタル検索
    body.querySelector('#pk-tag-name').oninput = (e) => {
      const q = e.target.value.toLowerCase().normalize('NFKC');
      if (!q) {
        // 元の表示に戻す
        renderTagSuggestions(recentTags, popularTags);
        return;
      }
      const filtered = allTags.filter(t => 
        t.name.toLowerCase().normalize('NFKC').includes(q)
      ).slice(0, 20);
      renderFilteredSuggestions(filtered);
    };
    
    function renderTagSuggestions(recent, popular) {
      const el = body.querySelector('#pk-tag-suggestions');
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
    
    attachSuggestionClicks();
    renderSelected();
    updateSuggestionHighlights();
    
    // ラジオ・チェックボックスの見た目更新
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
    
    // キャンセル
    body.querySelector('.pk-cancel').onclick = () => overlay.remove();
    
    // 保存
    body.querySelector('.pk-submit').onclick = async () => {
      const statusInput = body.querySelector('input[name="pk-status"]:checked');
      if (!statusInput) {
        alert('ステータスを選択してください');
        return;
      }
      
      // 入力欄に残っているタグを自動追加
      const tagNameInput = body.querySelector('#pk-tag-name');
      const pendingTagName = tagNameInput.value.trim();
      if (pendingTagName) {
        const prefix = body.querySelector('#pk-prefix').value;
        const fullTag = prefix ? `${prefix}/${pendingTagName}` : pendingTagName;
        
        // 表記ゆれチェック（既存タグと同じ正規化形なら、既存タグを使う）
        const similar = findSimilarTags(fullTag, allTags.map(t => t.name));
        if (similar.length > 0) {
          // 既存タグがある場合、それを使う（重複追加は防ぐ）
          if (!selectedTags.includes(similar[0])) {
            selectedTags.push(similar[0]);
          }
        } else if (!selectedTags.includes(fullTag)) {
          selectedTags.push(fullTag);
        }
        tagNameInput.value = '';
      }
      
      const btn = body.querySelector('.pk-submit');
      btn.disabled = true;
      btn.textContent = '保存中...';
      
      const flagsChecked = Array.from(body.querySelectorAll('input[name="pk-flag"]:checked')).map(c => c.value);
      
      const result = await callGas('save', {
        url: pageData.url,
        normalizedUrl: pageData.normalizedUrl,
        title: body.querySelector('#pk-title').value,
        excerpt: body.querySelector('#pk-excerpt').value,
        note: body.querySelector('#pk-note').value,
        tags: selectedTags,
        status: statusInput.value,
        flags: flagsChecked,
      });
      
      if (result.success) {
        setHTML(body, `
          <div class="pk-success">
            <p>✅ 保存しました</p>
            <p><a href="${result.docUrl}" target="_blank">📄 Docを開く</a></p>
          </div>
        `);
        setTimeout(() => overlay.remove(), 2000);
      } else {
        const banner = body.querySelector('.pk-status-banner');
        banner.className = 'pk-status-banner error';
        banner.textContent = '❌ エラー: ' + (result.error || 'unknown');
        btn.disabled = false;
        btn.textContent = '保存';
      }
    };
  }
  
  // ============================================
  // メイン処理
  // ============================================
  const overlay = buildOverlay();
  const pageData = collectPageData();
  
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
    
    // 並列に取得
    const [existing, prefixesRes, tagsRes] = await Promise.all([
      callGas('check', {
        url: pageData.url,
        normalizedUrl: pageData.normalizedUrl,
      }),
      callGas('getPrefixes', {}),
      callGas('getTags', {}),
    ]);
    
    renderForm(overlay, pageData, existing, prefixesRes.prefixes || [], tagsRes.tags || []);
  } catch (err) {
    setHTML(overlay.querySelector('.pk-body'), `
      <div class="pk-status-banner error">通信エラー: ${err.message}</div>
    `);
  }
})();
