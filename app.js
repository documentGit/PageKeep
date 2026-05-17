// ============================================
// PageKeep - Client Script (MVP)
// ============================================
(async function() {
  'use strict';
  
  const REQUIRED_GAS_VERSION = 1;
  
  // Trusted Types 対応：innerHTMLを安全に設定するためのヘルパー
  let trustedHTMLPolicy = null;
  if (window.trustedTypes && window.trustedTypes.createPolicy) {
    try {
      trustedHTMLPolicy = window.trustedTypes.createPolicy('pagekeep-html-' + Date.now(), {
        createHTML: (s) => s
      });
    } catch (e) {
      // ポリシー作成失敗時は素のinnerHTMLを使う
    }
  }
  
  function setHTML(element, html) {
    if (trustedHTMLPolicy) {
      element.innerHTML = trustedHTMLPolicy.createHTML(html);
    } else {
      element.innerHTML = html;
    }
  }
  
  // ブックマークレットが window に注入した値を読む
  const gasUrl = window.__PAGEKEEP_GAS_URL__;
  const secret = window.__PAGEKEEP_SECRET__;
  
  if (!gasUrl || !secret) {
    alert('PageKeep: 設定が不完全です。ブックマークレットを作り直してください。');
    return;
  }
  
  // 既存オーバーレイがあれば削除
  const existing = document.getElementById('__pagekeep_overlay__');
  if (existing) existing.remove();
  
  // ============================================
  // URL正規化
  // ============================================
  function normalizeUrl(url) {
    let u;
    try {
      u = new URL(url);
    } catch {
      return url;
    }
    
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
        if (embedMatch) {
          videoId = embedMatch[1];
          u.pathname = '/watch';
        } else if (shortsMatch) {
          videoId = shortsMatch[1];
          u.pathname = '/watch';
        } else {
          videoId = u.searchParams.get('v');
        }
      }
      if (u.pathname === '/watch' && videoId) {
        const newParams = new URLSearchParams();
        newParams.set('v', videoId);
        u.search = newParams.toString();
      }
    }
    
    return u.toString();
  }
  
  // ============================================
  // ページ情報収集
  // ============================================
  function collectPageData() {
    const url = location.href;
    const normalizedUrl = normalizeUrl(url);
    
    const title = (
      document.querySelector('meta[property="og:title"]')?.content ||
      document.title ||
      ''
    ).trim();
    
    let excerpt = window.getSelection().toString().trim();
    if (!excerpt) {
      excerpt = (
        document.querySelector('meta[property="og:description"]')?.content ||
        document.querySelector('meta[name="description"]')?.content ||
        ''
      ).trim();
    }
    
    return { url, normalizedUrl, title, excerpt };
  }
  
  // ============================================
  // サーバー通信
  // ============================================
  async function callGas(action, payload) {
    const res = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, secret, ...payload }),
    });
    return await res.json();
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
          font-size: 16px;
          color: #1a1a1a;
        }
        #__pagekeep_overlay__ .pk-modal {
          background: #fff; border-radius: 12px;
          width: min(480px, 92%); max-height: 88vh;
          overflow-y: auto;
          padding: 20px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        #__pagekeep_overlay__ .pk-header {
          display: flex; justify-content: space-between; align-items: center;
          margin-bottom: 16px;
        }
        #__pagekeep_overlay__ h2 {
          margin: 0; font-size: 18px;
        }
        #__pagekeep_overlay__ .pk-close {
          background: none; border: none; font-size: 24px;
          cursor: pointer; padding: 0 8px; color: #666;
        }
        #__pagekeep_overlay__ label {
          display: block; font-size: 12px; color: #666;
          margin: 12px 0 4px;
        }
        #__pagekeep_overlay__ input,
        #__pagekeep_overlay__ textarea {
          width: 100%; padding: 10px;
          border: 1px solid #ddd; border-radius: 6px;
          box-sizing: border-box; font-size: 16px;
          font-family: inherit;
          background: #fff; color: #1a1a1a;
        }
        #__pagekeep_overlay__ textarea {
          min-height: 80px; resize: vertical;
        }
        #__pagekeep_overlay__ .pk-status {
          padding: 8px 12px; border-radius: 6px;
          font-size: 14px; margin-bottom: 12px;
        }
        #__pagekeep_overlay__ .pk-status.new {
          background: #e3f2fd; color: #0066cc;
        }
        #__pagekeep_overlay__ .pk-status.existing {
          background: #fff3cd; color: #856404;
        }
        #__pagekeep_overlay__ .pk-status.error {
          background: #f8d7da; color: #721c24;
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
          #__pagekeep_overlay__ {
            color: #e0e0e0;
          }
          #__pagekeep_overlay__ .pk-modal {
            background: #2a2a2a;
          }
          #__pagekeep_overlay__ input,
          #__pagekeep_overlay__ textarea {
            background: #1a1a1a; color: #e0e0e0;
            border-color: #444;
          }
          #__pagekeep_overlay__ button.pk-btn {
            background: #2a2a2a; color: #e0e0e0;
            border-color: #444;
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
  
  function renderForm(overlay, pageData, existing) {
    const body = overlay.querySelector('.pk-body');
    const statusClass = existing.exists ? 'existing' : 'new';
    const statusText = existing.exists
      ? `⚠ このページは既に保存済みです（${existing.updateCount + 1}回目の保存）`
      : '✓ 新規ページとして保存します';
    
    setHTML(body, `
      <div class="pk-status ${statusClass}">${statusText}</div>
      
      <label>タイトル</label>
      <input type="text" id="pk-title" value="${escapeAttr(pageData.title)}">
      
      <label>タグ（カンマ区切り）</label>
      <input type="text" id="pk-tags" value="${escapeAttr((existing.tags || []).join(', '))}" placeholder="例: tech, ai, あとで読む">
      
      <label>抜粋</label>
      <textarea id="pk-excerpt">${escapeText(pageData.excerpt)}</textarea>
      
      <label>メモ</label>
      <textarea id="pk-note" placeholder="一言コメント"></textarea>
      
      <div class="pk-actions">
        <button class="pk-btn pk-cancel">キャンセル</button>
        <button class="pk-btn pk-btn-primary pk-submit">保存</button>
      </div>
    `);
    
    body.querySelector('.pk-cancel').onclick = () => overlay.remove();
    body.querySelector('.pk-submit').onclick = async () => {
      const btn = body.querySelector('.pk-submit');
      btn.disabled = true;
      btn.textContent = '保存中...';
      
      const result = await callGas('save', {
        url: pageData.url,
        normalizedUrl: pageData.normalizedUrl,
        title: body.querySelector('#pk-title').value,
        excerpt: body.querySelector('#pk-excerpt').value,
        note: body.querySelector('#pk-note').value,
        tags: body.querySelector('#pk-tags').value
          .split(',').map(t => t.trim()).filter(Boolean),
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
        const statusEl = body.querySelector('.pk-status');
        statusEl.className = 'pk-status error';
        statusEl.textContent = '❌ エラー: ' + (result.error || 'unknown');
        btn.disabled = false;
        btn.textContent = '保存';
      }
    };
  }
  
  function escapeAttr(s) {
    return String(s || '').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }
  function escapeText(s) {
    return String(s || '').replace(/</g, '&lt;');
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
        <div class="pk-status error">
          GASの更新が必要です（現在: v${versionRes.version} / 必要: v${REQUIRED_GAS_VERSION}）
        </div>
        <p>guide.htmlで最新版のGASコードを取得してください。</p>
      `);
      return;
    }
    
    const existing = await callGas('check', {
      url: pageData.url,
      normalizedUrl: pageData.normalizedUrl,
    });
    
    renderForm(overlay, pageData, existing);
  } catch (err) {
    setHTML(overlay.querySelector('.pk-body'), `
      <div class="pk-status error">
        通信エラー: ${err.message}<br>
        GASのURLとシークレットを確認してください。
      </div>
    `);
  }
})();
