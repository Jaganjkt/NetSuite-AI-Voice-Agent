/**
 * @NApiVersion 2.1
 * @NScriptType Suitelet
 * @NModuleScope SameAccount
 * @description Main Voice Agent Suitelet — serves voice UI inside NetSuite chrome and handles AJAX API calls
 */
define(['N/ui/serverWidget', 'N/runtime', 'N/log', 'N/url',
    './lib/NAVA_IntentResolver',
    './lib/NAVA_TranslationEngine',
    './lib/NAVA_LLMOrchestrator',
    './lib/NAVA_ActionRouter',
    './lib/NAVA_AuditLog'],
function (serverWidget, runtime, log, url,
    intentResolver, translationEngine, llmOrchestrator, actionRouter, auditLog) {

    function onRequest(context) {
        if (context.request.method === 'GET') {
            return handleGet(context);
        }
        return handlePost(context);
    }

    function handleGet(context) {
        var form = serverWidget.createForm({ title: ' ' });

        var htmlField = form.addField({
            id: 'custpage_nava_ui',
            type: serverWidget.FieldType.INLINEHTML,
            label: ' '
        });

        var user = runtime.getCurrentUser();
        var userJson = JSON.stringify({
            id: user.id,
            name: user.name,
            role: user.role,
            email: user.email
        });

        var suiteletUrl = url.resolveScript({
            scriptId: runtime.getCurrentScript().id,
            deploymentId: runtime.getCurrentScript().deploymentId,
            returnExternalUrl: false
        });

        htmlField.defaultValue = buildVoiceUI(userJson, suiteletUrl);

        context.response.writePage(form);
    }

    function handlePost(context) {
        var rawBody = context.request.body;
        var body;
        try {
            body = JSON.parse(rawBody);
        } catch (e) {
            context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
            context.response.write(JSON.stringify({ success: false, message: 'Invalid request format.' }));
            return;
        }
        var action = body.action;

        var result;
        try {
            switch (action) {
                case 'process_voice':
                    result = processVoiceCommand(body);
                    break;
                case 'confirm_action':
                    result = confirmAndExecute(body);
                    break;
                case 'reject_action':
                    result = rejectAction(body);
                    break;
                case 'get_languages':
                    result = { success: true, languages: translationEngine.getSupportedLanguages() };
                    break;
                default:
                    result = { success: false, message: 'Unknown action: ' + action };
            }
        } catch (e) {
            log.error('NAVA_Suitelet', e.message + '\n' + e.stack);
            try { auditLog.logError({ action: action }, e.message, body.sessionId); } catch (le) { }
            result = { success: false, message: 'Error: ' + e.message };
        }

        context.response.setHeader({ name: 'Content-Type', value: 'application/json' });
        context.response.write(JSON.stringify(result));
    }

    function processVoiceCommand(body) {
        var transcript = body.transcript;
        var sessionId = body.sessionId;
        var sourceLanguage = body.sourceLanguage;

        try { auditLog.logVoiceInput(transcript, sessionId); } catch (e) { log.error('NAVA', 'Audit log failed: ' + e.message); }

        var translation = translationEngine.translateToEnglish(transcript, sourceLanguage);
        var englishTranscript = translation.text;

        if (translation.wasTranslated) {
            log.audit('NAVA', 'Translated from ' + translation.sourceLanguageName + ': ' + englishTranscript);
        }

        var intent = intentResolver.resolve(englishTranscript);

        try { auditLog.logIntentResolution(englishTranscript, intent, sessionId); } catch (e) { }

        if (intent.executionPolicy === 'reject') {
            var clarification;
            try {
                clarification = llmOrchestrator.generateSimpleResponse(
                    'The user said: "' + englishTranscript + '". I could not understand the intent. ' +
                    'Politely ask for clarification and suggest what commands are available.'
                );
            } catch (e) {
                clarification = 'I did not understand that command. Try saying things like "Search sales orders", "Open invoice 10021", or "Create purchase order for Acme".';
            }

            return {
                success: true,
                type: 'clarification',
                message: clarification,
                intent: intent,
                translated: translation.wasTranslated,
                sourceLanguage: translation.sourceLanguageName || null
            };
        }

        if (intent.executionPolicy === 'confirm') {
            return {
                success: true,
                type: 'confirmation_required',
                message: buildConfirmationMessage(intent),
                intent: intent,
                translated: translation.wasTranslated,
                sourceLanguage: translation.sourceLanguageName || null
            };
        }

        var executionResult = actionRouter.executeIntent(intent);
        try { auditLog.logActionResult(intent, executionResult, sessionId); } catch (e) { }

        return {
            success: executionResult.success !== false,
            type: 'result',
            message: executionResult.message || 'Done.',
            data: executionResult,
            intent: intent,
            translated: translation.wasTranslated,
            sourceLanguage: translation.sourceLanguageName || null
        };
    }

    function confirmAndExecute(body) {
        var intent = body.intent;
        var sessionId = body.sessionId;

        try { auditLog.logUserConfirmation(intent, true, sessionId); } catch (e) { }

        var result = actionRouter.executeIntent(intent);
        try { auditLog.logActionResult(intent, result, sessionId); } catch (e) { }

        return {
            success: true,
            type: 'result',
            message: result.message,
            data: result
        };
    }

    function rejectAction(body) {
        try { auditLog.logUserConfirmation(body.intent, false, body.sessionId); } catch (e) { }
        return { success: true, type: 'rejected', message: 'Action cancelled.' };
    }

    function buildConfirmationMessage(intent) {
        var msg = 'I want to ' + intent.action + ' a ' + intent.recordType;
        if (intent.parameters.entityName) {
            msg += ' for ' + intent.parameters.entityName;
        }
        if (intent.parameters.documentNumber) {
            msg += ' (Document: ' + intent.parameters.documentNumber + ')';
        }
        msg += '. Confidence: ' + Math.round(intent.confidence * 100) + '%. Shall I proceed?';
        return msg;
    }

    function buildVoiceUI(userJson, suiteletUrl) {
        return [
'<style>',
'#nava-wrapper {',
'  --nava-primary: #003764;',
'  --nava-accent: #0070d2;',
'  --nava-success: #3d7a41;',
'  --nava-warning: #b95c00;',
'  --nava-danger: #d64700;',
'  --nava-bg: #f4f6f9;',
'  --nava-surface: #ffffff;',
'  --nava-text: #1a1a1a;',
'  --nava-text-muted: #6b7280;',
'  --nava-border: #e0e5ec;',
'  --nava-radius: 12px;',
'  --nava-shadow: 0 2px 8px rgba(0,0,0,0.08);',
'  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
'  background: var(--nava-bg);',
'  color: var(--nava-text);',
'  max-width: 860px;',
'  margin: 0 auto;',
'  padding: 10px 20px 20px;',
'  min-height: 600px;',
'  display: flex;',
'  flex-direction: column;',
'}',
'#nava-header {',
'  text-align: center;',
'  padding: 16px 0 12px;',
'}',
'#nava-header h1 {',
'  font-size: 22px;',
'  font-weight: 700;',
'  color: var(--nava-primary);',
'  margin-bottom: 2px;',
'}',
'#nava-header .subtitle {',
'  font-size: 13px;',
'  color: var(--nava-text-muted);',
'}',
'#nava-chat {',
'  flex: 1;',
'  overflow-y: auto;',
'  padding: 12px 0;',
'  display: flex;',
'  flex-direction: column;',
'  gap: 10px;',
'  min-height: 350px;',
'  max-height: 55vh;',
'}',
'.nava-msg {',
'  max-width: 85%;',
'  padding: 12px 16px;',
'  border-radius: var(--nava-radius);',
'  line-height: 1.5;',
'  font-size: 14px;',
'  box-shadow: var(--nava-shadow);',
'  animation: navaFadeIn 0.3s ease;',
'  word-wrap: break-word;',
'}',
'.nava-msg.user {',
'  align-self: flex-end;',
'  background: var(--nava-accent);',
'  color: white;',
'  border-bottom-right-radius: 4px;',
'}',
'.nava-msg.assistant {',
'  align-self: flex-start;',
'  background: var(--nava-surface);',
'  border: 1px solid var(--nava-border);',
'  border-bottom-left-radius: 4px;',
'}',
'.nava-msg.system {',
'  align-self: center;',
'  background: transparent;',
'  color: var(--nava-text-muted);',
'  font-size: 12px;',
'  box-shadow: none;',
'}',
'.nava-lang-badge {',
'  display: inline-block;',
'  background: rgba(0,55,100,0.1);',
'  padding: 2px 8px;',
'  border-radius: 10px;',
'  font-size: 11px;',
'  margin-bottom: 6px;',
'  color: var(--nava-primary);',
'}',
'.nava-conf-bar {',
'  height: 4px;',
'  background: #e0e0e0;',
'  border-radius: 2px;',
'  margin-top: 8px;',
'  overflow: hidden;',
'}',
'.nava-conf-bar .fill {',
'  height: 100%;',
'  border-radius: 2px;',
'  transition: width 0.5s ease;',
'}',
'.nava-actions {',
'  display: flex;',
'  gap: 8px;',
'  margin-top: 10px;',
'}',
'.nava-btn {',
'  padding: 7px 18px;',
'  border: none;',
'  border-radius: 8px;',
'  font-size: 13px;',
'  font-weight: 600;',
'  cursor: pointer;',
'  transition: all 0.2s;',
'}',
'.nava-btn-yes { background: var(--nava-success); color: white; }',
'.nava-btn-yes:hover { background: #2d5a31; }',
'.nava-btn-no { background: #f3f4f6; color: var(--nava-text); border: 1px solid var(--nava-border); }',
'.nava-btn-no:hover { background: #e5e7eb; }',
'.nava-btn-open { background: var(--nava-accent); color: white; text-decoration: none; display: inline-block; padding: 7px 18px; border-radius: 8px; font-size: 13px; font-weight: 600; }',
'.nava-btn-open:hover { background: #005bb5; }',
'#nava-controls {',
'  padding: 12px 0 0;',
'  display: flex;',
'  gap: 8px;',
'  align-items: center;',
'}',
'#nava-input {',
'  flex: 1;',
'  padding: 11px 14px;',
'  border: 2px solid var(--nava-border);',
'  border-radius: var(--nava-radius);',
'  font-size: 14px;',
'  outline: none;',
'  transition: border-color 0.2s;',
'}',
'#nava-input:focus { border-color: var(--nava-accent); }',
'#nava-mic {',
'  width: 48px; height: 48px;',
'  border-radius: 50%; border: none;',
'  background: var(--nava-primary); color: white;',
'  font-size: 20px; cursor: pointer;',
'  display: flex; align-items: center; justify-content: center;',
'  flex-shrink: 0; transition: all 0.2s;',
'}',
'#nava-mic:hover { background: var(--nava-accent); }',
'#nava-mic.rec {',
'  background: var(--nava-danger);',
'  animation: navaPulse 1.5s infinite;',
'}',
'#nava-send {',
'  width: 48px; height: 48px;',
'  border-radius: 50%; border: none;',
'  background: var(--nava-accent); color: white;',
'  font-size: 17px; cursor: pointer;',
'  flex-shrink: 0;',
'}',
'#nava-send:hover { background: #005bb5; }',
'#nava-status {',
'  text-align: center;',
'  font-size: 12px;',
'  color: var(--nava-text-muted);',
'  padding: 4px 0;',
'  min-height: 20px;',
'}',
'@keyframes navaPulse {',
'  0%,100% { box-shadow: 0 0 0 0 rgba(214,71,0,0.4); }',
'  50% { box-shadow: 0 0 0 12px rgba(214,71,0,0); }',
'}',
'@keyframes navaFadeIn {',
'  from { opacity: 0; transform: translateY(6px); }',
'  to { opacity: 1; transform: translateY(0); }',
'}',
'.nava-dots { display: inline-flex; gap: 4px; padding: 6px 12px; }',
'.nava-dots span { width: 7px; height: 7px; background: var(--nava-text-muted); border-radius: 50%; animation: navaBounce 1.4s infinite; }',
'.nava-dots span:nth-child(2) { animation-delay: 0.2s; }',
'.nava-dots span:nth-child(3) { animation-delay: 0.4s; }',
'@keyframes navaBounce { 0%,80%,100% { transform: scale(0); } 40% { transform: scale(1); } }',
'@media (max-width: 600px) {',
'  #nava-wrapper { padding: 8px 12px; }',
'  #nava-header h1 { font-size: 18px; }',
'  .nava-msg { max-width: 92%; font-size: 13px; padding: 10px 12px; }',
'  #nava-input { font-size: 16px; }',
'}',
'</style>',
'',
'<div id="nava-wrapper">',
'  <div id="nava-header">',
'    <h1>&#x1F399; NetSuite AI Voice Agent</h1>',
'    <div class="subtitle">Speak or type to interact with NetSuite</div>',
'  </div>',
'  <div id="nava-chat">',
'    <div class="nava-msg assistant">',
'      Hello! I am <strong>NAVA</strong>, your NetSuite AI Voice Agent.<br><br>',
'      <strong>&bull;</strong> "Search sales orders for ABC Corp"<br>',
'      <strong>&bull;</strong> "Open invoice 10021"<br>',
'      <strong>&bull;</strong> "Create a purchase order for Acme"<br>',
'      <strong>&bull;</strong> "Approve purchase order PO-4421"<br><br>',
'      I support 30+ languages. Speak or type naturally!',
'    </div>',
'  </div>',
'  <div id="nava-status"></div>',
'  <div id="nava-controls">',
'    <input id="nava-input" type="text" placeholder="Type a command or question..." autocomplete="off" />',
'    <button type="button" id="nava-mic" title="Click to speak (Ctrl+M)">&#x1F3A4;</button>',
'    <button type="button" id="nava-send" title="Send">&#x27A4;</button>',
'  </div>',
'</div>',
'',
'<script>',
'(function() {',
'  "use strict";',
'',
'  var NAVA_URL = "' + suiteletUrl + '";',
'  var NAVA_SESSION = "nava_" + Date.now() + "_" + Math.random().toString(36).substr(2,9);',
'  var pendingIntent = null;',
'  var busy = false;',
'',
'  var chat = document.getElementById("nava-chat");',
'  var inp  = document.getElementById("nava-input");',
'  var mic  = document.getElementById("nava-mic");',
'  var send = document.getElementById("nava-send");',
'  var stat = document.getElementById("nava-status");',
'',
'  /* ── Speech Recognition ── */',
'  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;',
'  var rec = null, recording = false;',
'',
'  if (SR) {',
'    rec = new SR();',
'    rec.continuous = false;',
'    rec.interimResults = true;',
'    rec.maxAlternatives = 1;',
'',
'    rec.onstart = function() {',
'      recording = true;',
'      mic.classList.add("rec");',
'      stat.textContent = "Listening... speak now";',
'    };',
'',
'    rec.onresult = function(ev) {',
'      var txt = "", fin = false;',
'      for (var i = ev.resultIndex; i < ev.results.length; i++) {',
'        txt += ev.results[i][0].transcript;',
'        if (ev.results[i].isFinal) fin = true;',
'      }',
'      inp.value = txt;',
'      if (fin) { rec.stop(); submit(txt, null); }',
'    };',
'',
'    rec.onerror = function(ev) {',
'      recording = false;',
'      mic.classList.remove("rec");',
'      var m = ev.error === "not-allowed" ? "Microphone blocked. Allow it in browser settings."',
'           : ev.error === "no-speech"    ? "No speech detected. Try again."',
'           : "Voice error: " + ev.error;',
'      stat.textContent = m;',
'    };',
'',
'    rec.onend = function() {',
'      recording = false;',
'      mic.classList.remove("rec");',
'      if (!busy) stat.textContent = "";',
'    };',
'  } else {',
'    mic.style.opacity = "0.35";',
'    mic.style.cursor = "not-allowed";',
'    mic.title = "Voice not supported — use Chrome or Edge";',
'  }',
'',
'  /* ── Events ── */',
'  mic.addEventListener("click", function(e) {',
'    e.preventDefault(); e.stopPropagation();',
'    if (!rec) { stat.textContent = "Voice not available. Type your command."; return; }',
'    if (recording) { rec.stop(); return; }',
'    try { inp.value = ""; rec.start(); }',
'    catch(err) { stat.textContent = "Mic error: " + err.message; }',
'  });',
'',
'  send.addEventListener("click", function(e) {',
'    e.preventDefault(); e.stopPropagation();',
'    var t = inp.value.trim();',
'    if (t) submit(t, null);',
'  });',
'',
'  inp.addEventListener("keydown", function(e) {',
'    if (e.key === "Enter") {',
'      e.preventDefault(); e.stopPropagation();',
'      var t = inp.value.trim();',
'      if (t) submit(t, null);',
'    }',
'  });',
'',
'  document.addEventListener("keydown", function(e) {',
'    if ((e.ctrlKey || e.metaKey) && e.key === "m") { e.preventDefault(); mic.click(); }',
'    if (e.key === "Escape" && recording && rec) rec.stop();',
'  });',
'',
'  /* ── Core ── */',
'  function submit(text, lang) {',
'    if (busy) return;',
'    busy = true;',
'    addMsg("user", text);',
'    inp.value = ""; inp.focus();',
'    showDots();',
'    stat.textContent = "Processing...";',
'    post("process_voice", { transcript: text, sessionId: NAVA_SESSION, sourceLanguage: lang });',
'  }',
'',
'  function post(action, data) {',
'    data.action = action;',
'    var x = new XMLHttpRequest();',
'    x.open("POST", NAVA_URL, true);',
'    x.setRequestHeader("Content-Type", "application/json");',
'    x.timeout = 120000;',
'',
'    x.onload = function() {',
'      busy = false; hideDots(); stat.textContent = "";',
'      try { handle(JSON.parse(x.responseText)); }',
'      catch(e) { addMsg("assistant", "Error parsing response. Check script logs."); }',
'    };',
'    x.onerror = function() {',
'      busy = false; hideDots(); stat.textContent = "";',
'      addMsg("assistant", "Network error. Check your connection.");',
'    };',
'    x.ontimeout = function() {',
'      busy = false; hideDots(); stat.textContent = "";',
'      addMsg("assistant", "Request timed out. Try a simpler command.");',
'    };',
'    x.send(JSON.stringify(data));',
'  }',
'',
'  function handle(r) {',
'    if (!r.success) { addMsg("assistant", r.message || "Something went wrong."); return; }',
'',
'    var badge = "";',
'    if (r.translated && r.sourceLanguage) badge = \'<div class="nava-lang-badge">Translated from \' + esc(r.sourceLanguage) + "</div>";',
'',
'    if (r.type === "confirmation_required") {',
'      pendingIntent = r.intent;',
'      var c = r.intent.confidence || 0;',
'      var col = c >= 0.85 ? "var(--nava-success)" : c >= 0.6 ? "var(--nava-warning)" : "var(--nava-danger)";',
'      var h = badge + esc(r.message);',
'      h += \'<div class="nava-conf-bar"><div class="fill" style="width:\' + Math.round(c*100) + \'%;background:\' + col + \'"></div></div>\';',
'      h += \'<div class="nava-actions">\';',
'      h += \'<button type="button" class="nava-btn nava-btn-yes" onclick="window._navaYes()">Yes, proceed</button>\';',
'      h += \'<button type="button" class="nava-btn nava-btn-no" onclick="window._navaNo()">Cancel</button>\';',
'      h += "</div>";',
'      addMsg("assistant", h, true);',
'      say(r.message);',
'    } else if (r.type === "result") {',
'      var html = badge + esc(r.message);',
'      var recUrl = (r.data && r.data.recordUrl) ? r.data.recordUrl : null;',
'      if (recUrl) {',
'        html += \'<br><br><a href="\' + recUrl + \'" class="nava-btn-open" target="_blank">Open Record</a>\';',
'        window.open(recUrl, "_blank");',
'      }',
'      if (r.data && r.data.results && r.data.results.length > 0) {',
'        html += table(r.data.results);',
'        if (r.data.results.length === 1 && r.data.results[0].recordUrl) {',
'          window.open(r.data.results[0].recordUrl, "_blank");',
'        }',
'      }',
'      addMsg("assistant", html, true);',
'      say(r.message);',
'    } else if (r.type === "clarification") {',
'      addMsg("assistant", badge + esc(r.message), true);',
'      say(r.message);',
'    } else if (r.type === "rejected") {',
'      addMsg("system", "Action cancelled.");',
'    }',
'  }',
'',
'  window._navaYes = function() {',
'    if (!pendingIntent || busy) return;',
'    busy = true;',
'    addMsg("user", "Yes, proceed.");',
'    showDots();',
'    post("confirm_action", { intent: pendingIntent, sessionId: NAVA_SESSION });',
'    pendingIntent = null;',
'  };',
'  window._navaNo = function() {',
'    if (!pendingIntent) return;',
'    addMsg("user", "Cancel.");',
'    post("reject_action", { intent: pendingIntent, sessionId: NAVA_SESSION });',
'    pendingIntent = null;',
'  };',
'',
'  /* ── UI helpers ── */',
'  function addMsg(role, text, html) {',
'    var d = document.createElement("div");',
'    d.className = "nava-msg " + role;',
'    if (html) d.innerHTML = text; else d.textContent = text;',
'    chat.appendChild(d);',
'    chat.scrollTop = chat.scrollHeight;',
'  }',
'  function showDots() {',
'    var d = document.createElement("div");',
'    d.className = "nava-msg assistant"; d.id = "nava-dots";',
'    d.innerHTML = \'<div class="nava-dots"><span></span><span></span><span></span></div>\';',
'    chat.appendChild(d); chat.scrollTop = chat.scrollHeight;',
'  }',
'  function hideDots() {',
'    var d = document.getElementById("nava-dots");',
'    if (d && d.parentNode) d.parentNode.removeChild(d);',
'  }',
'  function esc(s) {',
'    if (!s) return "";',
'    return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");',
'  }',
'  function table(rows) {',
'    if (!rows || !rows.length) return "";',
'    var ks = Object.keys(rows[0]).filter(function(k){return k!=="internalId"&&k!=="recordUrl";});',
'    var h = \'<table style="width:100%;margin-top:10px;border-collapse:collapse;font-size:12px;">\';',
'    h += "<thead><tr>";',
'    ks.forEach(function(k){h += \'<th style="text-align:left;padding:5px 7px;border-bottom:2px solid var(--nava-border);font-weight:600;">\'+esc(k)+"</th>";});',
'    h += \'<th style="padding:5px 7px;border-bottom:2px solid var(--nava-border);"></th></tr></thead><tbody>\';',
'    rows.forEach(function(r){',
'      h += "<tr>";',
'      ks.forEach(function(k){h += \'<td style="padding:5px 7px;border-bottom:1px solid var(--nava-border);">\'+esc(r[k]||"-")+"</td>";});',
'      if(r.recordUrl) h += \'<td style="padding:5px 7px;border-bottom:1px solid var(--nava-border);"><a href="\'+r.recordUrl+\'" target="_blank" style="color:var(--nava-accent);">Open</a></td>\';',
'      h += "</tr>";',
'    });',
'    h += "</tbody></table>";',
'    return h;',
'  }',
'  function say(text) {',
'    if (!window.speechSynthesis || !text) return;',
'    var c = String(text).replace(/<[^>]+>/g,"").substring(0,300);',
'    if (!c) return;',
'    var u = new SpeechSynthesisUtterance(c);',
'    u.rate = 1; u.pitch = 1;',
'    window.speechSynthesis.speak(u);',
'  }',
'',
'  inp.focus();',
'})();',
'</script>'
        ].join('\n');
    }

    return { onRequest: onRequest };
});
