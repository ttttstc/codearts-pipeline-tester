/* CodeArts Pipeline Tester — Enterprise Logic */

(function () {
    'use strict';

    // State
    let config = null;
    let currentEnv = null;
    let selectedPipelines = new Set();
    let isRunning = false;
    let eventSource = null;

    // DOM Helpers
    const $ = (id) => document.getElementById(id);
    const esc = (str) => {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    };

    // DOM Elements
    const els = {
        envSelector: $('envSelector'),
        suiteList: $('suiteList'),
        execList: $('execList'),
        btnRun: $('btnRun'),
        btnSelectAll: $('btnSelectAll'),
        btnDeselectAll: $('btnDeselectAll'),
        btnReports: $('btnReports'),
        selectedCount: $('selectedCount'),
        progressBar: $('progressBar'),
        progressLabel: $('progressLabel'),
        logModal: $('logModalOverlay'),
        consoleBody: $('consoleLogBody'),
        drawerOverlay: $('drawerOverlay'),
        reportDrawer: $('reportDrawer'),
        reportList: $('reportList'),
        btnCloseDrawer: $('btnCloseDrawer'),
        toastContainer: $('toastContainer'),
        reportDetailOverlay: $('reportDetailOverlay'),
        reportDetailTitle: $('reportDetailTitle'),
        reportDetailBody: $('reportDetailBody')
    };

    // Initialization
    async function init() {
        try {
            const res = await fetch('/api/config');
            config = await res.json();
            renderEnvSelector();
            connectSSE();
        } catch (err) {
            toast('Failed to load config: ' + err.message, 'error');
        }

        bindEvents();
    }

    function bindEvents() {
        els.envSelector.addEventListener('change', onEnvChange);
        els.btnRun.addEventListener('click', onRun);
        els.btnSelectAll.addEventListener('click', () => toggleAll(true));
        els.btnDeselectAll.addEventListener('click', () => toggleAll(false));

        els.btnReports.addEventListener('click', openReportDrawer);
        els.btnCloseDrawer.addEventListener('click', closeReportDrawer);
        els.drawerOverlay.addEventListener('click', closeReportDrawer);

        // Log Modal Close handled by onclick in HTML
    }

    function renderEnvSelector() {
        els.envSelector.innerHTML = '';
        for (const [name, env] of Object.entries(config.envs)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = env.label || name;
            els.envSelector.appendChild(opt);
        }
        if (els.envSelector.options.length > 0) {
            onEnvChange();
        }
    }

    function onEnvChange() {
        currentEnv = els.envSelector.value;
        selectedPipelines.clear();
        renderSuites();
        updateCount();
    }

    function renderSuites() {
        const env = config.envs[currentEnv];
        if (!env || !env.suites) {
            els.suiteList.innerHTML = '<div class="loading-state">无配置信息</div>';
            return;
        }

        let html = '';
        for (const [suiteName, suiteData] of Object.entries(env.suites)) {
            const pipelines = Object.keys(suiteData.pipelines || {});

            // Build pipeline items
            const itemsHtml = pipelines.map(pName => {
                const isSelected = selectedPipelines.has(pName) ? 'selected' : '';
                return `
                <div class="pipeline-item ${isSelected}" data-name="${esc(pName)}" onclick="app.togglePipeline(this)">
                    <div class="checkbox-mock"></div>
                    <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(pName)}</span>
                </div>`;
            }).join('');

            html += `
            <div class="suite-group">
                <div class="suite-header" onclick="this.nextElementSibling.hidden = !this.nextElementSibling.hidden">
                    <span class="suite-icon">📂</span>
                    <span>${esc(suiteName)}</span>
                    <span style="font-size:11px;color:#999;margin-left:auto;background:#eee;padding:2px 6px;border-radius:10px">${pipelines.length}</span>
                </div>
                <div class="suite-items">${itemsHtml}</div>
            </div>`;
        }
        els.suiteList.innerHTML = html;
    }

    // Actions
    function togglePipeline(el) {
        if (isRunning) return;
        const name = el.dataset.name;
        if (selectedPipelines.has(name)) {
            selectedPipelines.delete(name);
            el.classList.remove('selected');
        } else {
            selectedPipelines.add(name);
            el.classList.add('selected');
        }
        updateCount();
    }

    function toggleAll(active) {
        if (isRunning) return;
        const items = els.suiteList.querySelectorAll('.pipeline-item');
        items.forEach(el => {
            const name = el.dataset.name;
            if (active) {
                selectedPipelines.add(name);
                el.classList.add('selected');
            } else {
                selectedPipelines.delete(name);
                el.classList.remove('selected');
            }
        });
        updateCount();
    }

    function updateCount() {
        els.selectedCount.textContent = selectedPipelines.size;
        els.btnRun.disabled = selectedPipelines.size === 0 || isRunning;
    }

    // Execution
    async function onRun() {
        if (isRunning || selectedPipelines.size === 0) return;

        isRunning = true;
        els.btnRun.textContent = 'Executing...';
        els.btnRun.disabled = true;

        const pipelines = [...selectedPipelines].map(name => ({ name }));

        renderExecInit(pipelines);

        try {
            const res = await fetch('/api/run', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ env: currentEnv, pipelines })
            });
            const data = await res.json();
            if (data.error) {
                toast(data.error, 'error');
                resetRunBtn();
            } else {
                toast(`Started ${pipelines.length} pipelines`, 'success');
            }
        } catch (err) {
            toast('Network Error', 'error');
            resetRunBtn();
        }
    }

    function resetRunBtn() {
        isRunning = false;
        els.btnRun.textContent = '启动测试';
        updateCount();
    }

    function renderExecInit(pipelines) {
        // Reset Progress
        els.progressBar.style.width = '0%';
        els.progressLabel.textContent = `0 / ${pipelines.length}`;

        // Render Rows
        let html = '';
        for (const p of pipelines) {
            html += renderExecRow(p.name, 'waiting', {});
        }
        els.execList.innerHTML = html;
    }

    function renderExecRow(name, status, result) {
        const icons = { waiting: '⏳', running: '🔄', completed: '✅', failed: '❌', error: '⚠️', timeout: '⏰' };
        let uiStatus = status.toLowerCase();
        if (uiStatus.includes('timeout')) uiStatus = 'timeout';
        else if (uiStatus.includes('error') || status === 'FAILED' || status === 'LOGIN_ERROR') uiStatus = 'failed';
        else if (status === 'COMPLETED') uiStatus = 'completed';

        // Detail text
        let detailHtml = '-';
        if (result && (result.runId || result.executor)) {
            const parts = [];
            if (result.runId) parts.push(`ID:${result.runId}`);
            if (result.executor) parts.push(result.executor);
            detailHtml = parts.join(' <span style="color:#ddd">|</span> ');
        }

        // Link
        let nameHtml = esc(name);
        if (result && result.detailUrl) {
            nameHtml += ` <a href="${result.detailUrl}" target="_blank" style="color:var(--c-brand);text-decoration:none;font-size:12px">🔗</a>`;
        }

        return `
        <div class="grid-row" data-exec="${esc(name)}">
            <div class="col-status"><span class="${uiStatus === 'running' ? 'spin' : ''}">${icons[uiStatus] || '•'}</span></div>
            <div class="col-name" title="${esc(name)}">${nameHtml}</div>
            <div class="col-info">${detailHtml}</div>
            <div class="col-time">${esc(result.duration || '-')}</div>
            <div class="col-result"><span class="badge ${uiStatus}">${esc(status)}</span></div>
        </div>`;
    }

    function updateExecRow(name, status, result) {
        const item = els.execList.querySelector(`[data-exec="${name}"]`);
        if (!item) {
            // console.warn('Row not found:', name);
            return;
        } // item might simply be in a previous list if we didn't clear correctly, but here we cleared.

        // Re-render the whole row contents for simplicity
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = renderExecRow(name, status, result);
        item.innerHTML = tempDiv.firstElementChild.innerHTML;

        // Handle startup timeout badge specifically
        if (status === 'STARTUP_TIMEOUT') {
            const badge = item.querySelector('.badge');
            if (badge) {
                badge.style.backgroundColor = '#fa9600'; // Override with warning color
                badge.textContent = '启动超时';
            }
        }
    }

    function appendLog(data) {
        const div = document.createElement('div');
        div.className = `log-line`;
        if (data.level === 'error') div.classList.add('log-error');
        div.innerHTML = `<span class="log-time">[${data.timestamp}]</span> ${esc(data.message)}`;
        els.consoleBody.appendChild(div);
        els.consoleBody.scrollTop = els.consoleBody.scrollHeight;
    }

    // SSE
    function connectSSE() {
        if (eventSource) eventSource.close();
        eventSource = new EventSource('/api/events');

        eventSource.addEventListener('task_progress', (e) => {
            const data = JSON.parse(e.data);
            updateExecRow(data.name, data.status, data.result);
            // Update Progress
            const pct = Math.round((data.completed / data.total) * 100);
            els.progressBar.style.width = `${pct}%`;
            els.progressLabel.textContent = `${data.completed} / ${data.total}`;
        });

        eventSource.addEventListener('task_log', (e) => {
            const data = JSON.parse(e.data);
            appendLog(data);
        });

        eventSource.addEventListener('task_done', (e) => {
            resetRunBtn();
            toast('执行完成', 'success');
        });

        eventSource.onerror = () => {
            // Reconnect logic
        };
    }

    // Global API
    window.app = {
        togglePipeline: (el) => togglePipeline(el),
        openLogModal: () => els.logModal.classList.add('active'),
        closeLogModal: () => els.logModal.classList.remove('active'),

        closeReportDrawer: closeReportDrawer,
        showReport: showReport, // see below
        closeReportDetail: () => els.reportDetailOverlay.classList.remove('active')
    };

    // Reports
    async function openReportDrawer() {
        els.reportDrawer.classList.add('active');
        els.drawerOverlay.classList.add('active');

        try {
            const res = await fetch('/api/reports');
            const reports = await res.json();
            if (reports.length === 0) {
                els.reportList.innerHTML = '<div style="padding:20px;text-align:center;color:#999">暂无历史报告</div>';
                return;
            }
            els.reportList.innerHTML = reports.map(r => `
                <div class="report-card" onclick="app.showReport(this)" data-content="${btoa(unescape(encodeURIComponent(r.content)))}" data-name="${esc(r.filename)}">
                    <div class="report-filename">${esc(r.filename)}</div>
                    <div class="report-preview" style="font-size:10px;color:#aaa">Click to view details...</div>
                </div>
            `).join('');
        } catch (e) {
            els.reportList.innerHTML = 'Load failed';
        }
    }

    function closeReportDrawer() {
        els.reportDrawer.classList.remove('active');
        els.drawerOverlay.classList.remove('active');
    }

    function showReport(el) {
        const content = decodeURIComponent(escape(atob(el.dataset.content)));
        const name = el.dataset.name;

        els.reportDetailTitle.textContent = name;
        els.reportDetailBody.innerHTML = `<pre style="font-family:Consolas;white-space:pre-wrap;color:#333">${esc(content)}</pre>`;
        els.reportDetailOverlay.classList.add('active');
    }

    function toast(msg, type) {
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.textContent = msg;
        els.toastContainer.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }

    // Start
    document.addEventListener('DOMContentLoaded', init);

})();
