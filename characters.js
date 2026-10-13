(() => {
  const root = document.querySelector('#charactersManager');
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  const percent = (current, maximum) => Math.max(0, Math.min(100, (Number(current) || 0) / Math.max(1, Number(maximum) || 1) * 100));
  const SHEET_LIBRARY_KEY = 'stone-plate-character-library-v1';
  const testableStats = [
    ['vitalidade', 'Vitalidade'], ['vitalityMax', 'Vitalidade máxima'], ['lucidez', 'Lucidez'], ['lucidityMax', 'Lucidez máxima'],
    ['agilidade', 'Agilidade'], ['forcaFisica', 'Força Física'], ['forcaEspecial', 'Força Especial'],
    ['resistenciaFisica', 'Resistência Física'], ['resistenciaEspecial', 'Resistência Especial'],
    ['resistenciaPerfeita', 'Resistência Perfeita'], ['intuicao', 'Intuição'], ['persuasao', 'Persuasão'],
    ['forca', 'Força'], ['forcaMult', 'Multiplicador de força'], ['dado', 'Dano base'],
    ['danoMult', 'Multiplicador de dano'], ['defesa', 'Defesa'], ['defesaMult', 'Multiplicador de defesa'],
    ['reducaoA', 'Redução inicial'], ['reducaoD', 'Redução final'], ['divisao', 'Divisão']
  ];
  let libraryMessage = '';
  let sheetLibrary = loadSheetLibrary();
  function statLimit(field) { return ['vitalidade', 'vitality', 'lucidez', 'lucidity', 'agilidade', 'vitalityMax', 'lucidityMax'].includes(field) ? 9999999 : 9999; }
  function boundedStat(field, value) { return Math.max(0, Math.min(statLimit(field), Number(value) || 0)); }
  function loadSheetLibrary() {
    try {
      const saved = JSON.parse(localStorage.getItem(SHEET_LIBRARY_KEY) || '[]');
      return Array.isArray(saved) ? saved.filter(item => item && typeof item.id === 'string' && item.sheet && typeof item.sheet === 'object') : [];
    } catch (error) {
      console.error('Não foi possível carregar a biblioteca de fichas.', error);
      libraryMessage = 'Não foi possível carregar as fichas salvas neste navegador.';
      return [];
    }
  }
  function saveSheetLibrary() {
    try {
      localStorage.setItem(SHEET_LIBRARY_KEY, JSON.stringify(sheetLibrary));
      libraryMessage = 'Ficha salva neste navegador.';
      return true;
    } catch (error) {
      console.error('Não foi possível salvar a ficha na biblioteca local.', error);
      libraryMessage = 'Não foi possível salvar. A imagem da ficha pode exceder o espaço disponível.';
      return false;
    }
  }
  const characterDamageExpression = character => String(character.damageExpression || '1d6');
  function isValidDamageExpression(source) {
    const expression = String(source || '').replace(/\s+/g, '').toLowerCase();
    const terms = [...expression.matchAll(/([+-]?)(?:(\d*)d(\d+)|(\d+))/g)];
    if (!expression || expression.length > 100 || !terms.length || terms.map(term => term[0]).join('') !== expression) return false;
    const sides = new Set();
    let quantity = 0;
    let modifier = 0;
    for (const [index, term] of terms.entries()) {
      if (index > 0 && !term[1]) return false;
      const sign = term[1] === '-' ? -1 : 1;
      if (term[3] !== undefined) {
        const count = Number(term[2] || 1);
        const dieSides = Number(term[3]);
        if (sign < 0 || ![2, 4, 6, 8, 10, 12, 20, 30, 60, 100].includes(dieSides) || !Number.isInteger(count) || count < 1 || count > 999) return false;
        quantity += count;
        sides.add(dieSides);
      } else modifier += sign * Number(term[4]);
    }
    return sides.size > 0 && sides.size <= 20 && quantity <= 999 && Number.isSafeInteger(modifier) && Math.abs(modifier) <= 100000;
  }
  function rollTotal(roll) {
    return roll.groups.reduce((sum, group) => sum + group.values.reduce((groupSum, value) => groupSum + value, 0), roll.modifier);
  }
  const avatarDataUrl = (name, index) => {
    const colors = ['#2563eb', '#f59e0b', '#ec4899', '#b14478', '#ef4444', '#b85682'];
    const initial = escape(String(name || 'P').trim().charAt(0) || 'P');
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" fill="${colors[index % colors.length]}"/><circle cx="48" cy="36" r="20" fill="#ffffff55"/><text x="48" y="84" text-anchor="middle" font-family="sans-serif" font-size="36" font-weight="700" fill="white">${initial}</text></svg>`;
    return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
  };
  const characterEntryId = character => `character-${character.id}`;
  let api;

  function turnEntries(health) {
    const entries = [
      ...health.characters.map((character, index) => ({ id: characterEntryId(character), name: character.name || `Personagem ${index + 1}`, character })),
      { id: 'boss', name: health.bossName || 'Boss', character: null }
    ];
    const ordered = [];
    const seen = new Set();
    for (const saved of Array.isArray(health.turnOrder) ? health.turnOrder : []) {
      const entry = entries.find(item => item.id === saved.id);
      if (entry && !seen.has(entry.id)) { ordered.push(entry); seen.add(entry.id); }
    }
    return [...ordered, ...entries.filter(entry => !seen.has(entry.id))];
  }

  function render() {
    if (!api || !root) return;
    const state = api.getState();
    const health = state.health;
    const characters = Array.isArray(health.characters) ? health.characters : [];
    const tokens = Array.isArray(state.tokens) ? state.tokens : [];
    const entries = turnEntries(health);
    health.activeTurnIndex = Math.max(0, Math.min(entries.length - 1, Number(health.activeTurnIndex) || 0));
    const activeEntry = entries[health.activeTurnIndex];
    const characterCards = characters.map((character, index) => {
      const vitality = Number(character.vitalidade ?? character.vitality ?? character.hp ?? 0);
      const vitalityMax = Number(character.vitalityMax ?? 100);
      const lucidity = Number(character.lucidez ?? character.lucidity ?? character.sanity ?? 0);
      const lucidityMax = Number(character.lucidityMax ?? 100);
      const attacks = Array.isArray(character.attacks) ? character.attacks : [];
      const tokenOptions = tokens.map(token => `<option value="${escape(token.id)}" ${String(character.linkedTokenId ?? '') === String(token.id) ? 'selected' : ''}>${escape(token.name || 'Token')}</option>`).join('');
      const statOptions = testableStats.map(([field, label]) => `<option value="${field}">${escape(label)}</option>`).join('');
      const attacksMarkup = attacks.map(attack => `<li class="sp-saved-attack"><span><strong>${escape(attack.name || 'Golpe')}</strong><small>${({ fisico: 'Físico', especial: 'Especial', bruto: 'Bruto', verdadeiro: 'Verdadeiro', alma: 'Alma' })[attack.damageType] || 'Físico'}${['bruto', 'verdadeiro', 'alma'].includes(attack.damageType) ? ` · Força ${attack.damageForceType === 'especial' ? 'Especial' : 'Física'}` : ''} · ${escape(attack.damageExpression || '1d6')}</small></span><button type="button" data-action="remove-attack" data-attack-id="${escape(attack.id)}" aria-label="Remover golpe ${escape(attack.name || '')}">×</button></li>`).join('');
      const avatar = character.imageDataUrl || avatarDataUrl(character.name || `Personagem ${index + 1}`, index);
      const activeEffects = (health.combatEffects || []).filter(effect => String(effect.targetTokenId || '') === String(character.linkedTokenId || ''));
      const activeEffectsMarkup = activeEffects.map(effect => {
        const source = tokens.find(token => String(token.id) === String(effect.sourceTokenId));
        return `<div class="field-note">${escape(effect.icon || '✦')} ${escape(effect.name || 'Efeito')}${effect.description ? ` · ${escape(effect.description)}` : ''} · até o fim do turno de ${escape(source?.name || 'quem aplicou')}</div>`;
      }).join('');
      return `<article class="sp-character-card${activeEntry?.id === characterEntryId(character) ? ' is-active' : ''}" data-character-id="${escape(character.id)}">
        <label class="sp-character-image" title="Selecionar imagem do personagem">
          <img src="${escape(avatar)}" alt="${escape(character.name || `Personagem ${index + 1}`)}">
          <input type="file" accept="image/*" data-character-image hidden>
        </label>
        <div class="sp-character-fields">
          <label>Nome<input type="text" maxlength="24" value="${escape(character.name || '')}" data-character-field="name"></label>
          <label>Token do mapa<select data-character-field="linkedTokenId"><option value="">Sem vínculo</option>${tokenOptions}</select></label>
          <div class="sp-stat-block"><div class="sp-stat-heading"><span>Vitalidade</span><span>${vitality} / ${vitalityMax}</span></div><div class="sp-stat-track"><i class="hp" style="width:${percent(vitality, vitalityMax)}%"></i></div><div class="sp-stat-values"><label>Atual<input type="number" min="0" max="9999999" value="${vitality}" data-character-field="vitalidade"></label><label>Máximo<input type="number" min="1" max="9999999" value="${vitalityMax}" data-character-field="vitalityMax"></label></div></div>
          <div class="sp-stat-block"><div class="sp-stat-heading"><span>Lucidez</span><span>${lucidity} / ${lucidityMax}</span></div><div class="sp-stat-track"><i class="sanity" style="width:${percent(lucidity, lucidityMax)}%"></i></div><div class="sp-stat-values"><label>Atual<input type="number" min="0" max="9999999" value="${lucidity}" data-character-field="lucidez"></label><label>Máximo<input type="number" min="1" max="9999999" value="${lucidityMax}" data-character-field="lucidityMax"></label></div></div>
          <div class="sp-stat-block"><div class="sp-stat-heading"><span>Estatísticas</span><span>Combate e social</span></div><div class="sp-stat-values" style="grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px;">
            <label>Agilidade<input type="number" min="0" max="9999999" step="1" value="${Number(character.agilidade ?? 0)}" data-character-field="agilidade"></label>
            <label>Força Física<input type="number" min="0" max="9999" step="1" value="${Number(character.forcaFisica ?? character.forca ?? 0)}" data-character-field="forcaFisica"></label>
            <label>Força Especial<input type="number" min="0" max="9999" step="1" value="${Number(character.forcaEspecial ?? 0)}" data-character-field="forcaEspecial"></label>
            <label>Resistência Física<input type="number" min="0" max="9999" step="1" value="${Number(character.resistenciaFisica ?? character.defesa ?? 0)}" data-character-field="resistenciaFisica"></label>
            <label>Resistência Especial<input type="number" min="0" max="9999" step="1" value="${Number(character.resistenciaEspecial ?? 0)}" data-character-field="resistenciaEspecial"></label>
            <label>Resistência Perfeita<input type="number" min="0" max="9999" step="1" value="${Number(character.resistenciaPerfeita ?? character.defesaP ?? 0)}" data-character-field="resistenciaPerfeita"></label>
            <label>Intuição<input type="number" min="0" max="9999" step="1" value="${Number(character.intuicao ?? 0)}" data-character-field="intuicao"></label>
            <label>Persuasão<input type="number" min="0" max="9999" step="1" value="${Number(character.persuasao ?? 0)}" data-character-field="persuasao"></label>
            <label>Força do dado<input type="number" min="0" max="9999" step="1" value="${Number(character.dado ?? 0)}" data-character-field="dado"></label>
          </div></div>
          ${activeEffectsMarkup}
          <label>Bônus crítico (%)<input type="number" min="0" step="0.1" value="${Number(character.criticalBonusPercent ?? 10)}" data-character-field="criticalBonusPercent"></label>
          <div class="sp-sheet-test"><label>Testar estatística<select data-test-stat>${statOptions}</select></label><button type="button" class="sp-secondary-action" data-action="test-stat">Rolar teste</button><span class="sp-action-result" data-stat-result aria-live="polite"></span></div>
          <div class="sp-attack-editor"><div class="sp-stat-heading"><span>Golpes salvos</span><span>${attacks.length}</span></div><ul class="sp-attack-list">${attacksMarkup || '<li class="sp-empty-state">Nenhum golpe salvo.</li>'}</ul><div class="sp-attack-form"><label>Nome<input type="text" maxlength="32" value="" data-new-attack-name placeholder="Ex.: Corte pesado"></label><label>Dano em dados<input type="text" maxlength="100" value="${escape(characterDamageExpression(character))}" data-new-attack-dice placeholder="2d6+1"></label><label>Tipo<select data-new-attack-type><option value="fisico">Físico</option><option value="especial">Especial</option><option value="bruto">Bruto</option><option value="verdadeiro">Verdadeiro</option><option value="alma">Alma</option></select></label><label>Força base<select data-new-attack-force-type><option value="fisico">Força Física</option><option value="especial">Força Especial</option></select></label><button type="button" class="sp-secondary-action" data-action="add-attack">Salvar golpe</button></div></div>
          <div class="sp-character-effects"><label class="sp-check"><input type="checkbox" data-character-field="emojiAuraEnabled" ${character.emojiAuraEnabled ? 'checked' : ''}> Emanar emoji</label><select data-character-field="emojiAuraEmoji" aria-label="Emoji da aura">${['💥','🔥','⚡','🗡️','☠️','🐉','👻','🩸','💀','🌪️','❄️','🛡️','🌙'].map(emoji => `<option ${emoji === (character.emojiAuraEmoji || '💥') ? 'selected' : ''}>${emoji}</option>`).join('')}</select><button type="button" data-action="remove-character" aria-label="Remover ${escape(character.name)}" title="Remover personagem">×</button></div>
        </div>
      </article>`;
    }).join('');
    const characterOptions = characters.map(character => `<option value="${escape(character.id)}">${escape(character.name || 'Personagem')}</option>`).join('');
    const templateOptions = sheetLibrary.map(item => `<option value="${escape(item.id)}">${escape(item.name || item.sheet.name || 'Ficha')}</option>`).join('');
    const orderMarkup = entries.map((entry, index) => `<li class="sp-turn-entry ${index === health.activeTurnIndex ? 'active' : ''}" draggable="true" data-turn-id="${escape(entry.id)}"><span class="sp-turn-index">${index + 1}</span><span class="sp-turn-name">${escape(entry.name)}</span><button type="button" data-action="move-up" ${index === 0 ? 'disabled' : ''} aria-label="Mover ${escape(entry.name)} para cima">↑</button><button type="button" data-action="move-down" ${index === entries.length - 1 ? 'disabled' : ''} aria-label="Mover ${escape(entry.name)} para baixo">↓</button></li>`).join('');

    root.innerHTML = `<div class="sp-manager-shell">
      <header class="sp-manager-header"><div><span class="sp-manager-eyebrow">STONE PLATE · MESTRE</span><h1>Personagens e combate</h1><p>Estado dos jogadores conectado aos tokens do mapa.</p></div><button class="sp-primary-action" type="button" data-action="open-display">Abrir tela dos jogadores ↗</button></header>
      <section class="sp-overview"><div class="sp-overview-title"><div><span class="sp-manager-eyebrow">BARRA GERAL</span><h2>Vida da sessão</h2></div><div class="sp-hp-preview"><i style="width:${percent(health.currentHp, health.maxHp)}%;background:${escape(health.color || '#c55480')}"></i><span>${escape(health.label || 'HP')} · ${health.currentHp} / ${health.maxHp}</span></div></div><div class="sp-global-fields"><label>Atual<input type="number" min="0" max="1000" value="${Number(health.currentHp) || 0}" data-health-field="currentHp"></label><label>Máximo<input type="number" min="1" max="1000" value="${Number(health.maxHp) || 100}" data-health-field="maxHp"></label><label>Rótulo<input type="text" maxlength="20" value="${escape(health.label || 'HP')}" data-health-field="label"></label><label>Cor<input type="color" value="${escape(health.color || '#c55480')}" data-health-field="color"></label><label>Modo<select data-health-field="displayMode"><option value="values" ${health.displayMode === 'values' ? 'selected' : ''}>Valores</option><option value="hidden" ${health.displayMode === 'hidden' ? 'selected' : ''}>Só barra</option><option value="damage" ${health.displayMode === 'damage' ? 'selected' : ''}>Dano</option></select></label><label class="sp-check"><input type="checkbox" data-health-field="showGlobalHealthBar" ${health.showGlobalHealthBar !== false ? 'checked' : ''}> Exibir barra geral na tela dos jogadores</label></div></section>
      <section class="sp-section"><div class="sp-section-heading"><div><span class="sp-manager-eyebrow">FICHA</span><h2>Personagens</h2></div><button type="button" class="sp-secondary-action" data-action="add-character" ${characters.length >= 10 ? 'disabled' : ''}>＋ Adicionar personagem</button></div><div class="sp-character-grid">${characterCards || '<p class="sp-empty-state">Nenhum personagem cadastrado.</p>'}</div></section>
      <section class="sp-section"><div class="sp-section-heading"><div><span class="sp-manager-eyebrow">BIBLIOTECA LOCAL</span><h2>Salvar e carregar fichas</h2></div></div><div class="sp-global-fields"><label>Ficha atual<select data-library-source>${characterOptions}</select></label><button type="button" class="sp-secondary-action" data-action="save-sheet" ${!characters.length ? 'disabled' : ''}>Salvar ficha completa</button><label>Ficha salva<select data-library-template><option value="">Selecione uma ficha</option>${templateOptions}</select></label><label>Substituir esta ficha<select data-library-target>${characterOptions}</select></label><button type="button" class="sp-secondary-action" data-action="load-sheet" ${!sheetLibrary.length || !characters.length ? 'disabled' : ''}>Carregar ficha</button><button type="button" class="sp-secondary-action" data-action="delete-sheet" ${!sheetLibrary.length ? 'disabled' : ''}>Excluir salva</button></div><p class="sp-library-status" aria-live="polite">${escape(libraryMessage || (sheetLibrary.length ? `${sheetLibrary.length} ficha(s) salva(s) neste navegador.` : 'As fichas salvas ficam disponíveis neste navegador.'))}</p></section>
      <section class="sp-section sp-boss-section"><div class="sp-section-heading"><div><span class="sp-manager-eyebrow">ENCONTRO</span><h2>Boss e efeitos</h2></div></div><div class="sp-boss-fields"><label>Nome do boss<input type="text" maxlength="24" value="${escape(health.bossName || 'Boss')}" data-health-field="bossName"></label><label>Movimento<select data-health-field="bossMovement"><option value="none" ${health.bossMovement === 'none' ? 'selected' : ''}>Nenhum</option><option value="rotating" ${health.bossMovement === 'rotating' ? 'selected' : ''}>Giratório</option><option value="lateral" ${health.bossMovement === 'lateral' ? 'selected' : ''}>Lateral</option><option value="bugged" ${health.bossMovement === 'bugged' ? 'selected' : ''}>Instável</option></select></label><label>After image<select data-health-field="bossAfterImageMode"><option value="none">Nenhuma</option><option value="bruta">Bruta</option><option value="devanecida">Devanecida</option><option value="leve">Leve</option><option value="forte">Forte</option><option value="colorida">Colorida</option><option value="arco-íris">Arco-íris</option></select></label><label>Cor do efeito<input type="color" value="${escape(health.bossAfterImageColor || '#ff4d4d')}" data-health-field="bossAfterImageColor"></label><label class="sp-file-field">Imagem do boss<input type="file" accept="image/*" data-health-field="imageDataUrl"></label></div>${health.imageDataUrl ? '' : '<p class="sp-boss-effect-note">Carregue uma imagem do boss para visualizar os movimentos e after-images na tela dos jogadores.</p>'}</section>
      <section class="sp-section sp-turn-section"><div class="sp-section-heading"><div><span class="sp-manager-eyebrow">INICIATIVA</span><h2>Ordem de turno</h2></div><div class="sp-turn-actions"><span>Rodada ${Math.max(1, Number(health.round) || 1)}</span><button type="button" class="sp-secondary-action" data-action="next-turn">Próximo turno ⏭</button></div></div><ol class="sp-turn-list">${orderMarkup}</ol></section>
      <section class="sp-section sp-global-damage"><div class="sp-section-heading"><div><span class="sp-manager-eyebrow">AJUSTE RÁPIDO</span><h2>Aplicar dano à barra geral</h2></div></div><div class="sp-global-fields"><label>Dano<input type="number" min="0" max="1000" value="0" data-damage-input></label><label>Emoji<select data-damage-emoji>${['💥','🔥','⚡','💣','🗡️','☠️','🐉','👻','🩸','💀'].map(emoji => `<option>${emoji}</option>`).join('')}</select></label><button type="button" class="sp-secondary-action" data-action="apply-global-damage">Aplicar dano</button></div></section>
    </div>`;
    const afterImageSelect = root.querySelector('[data-health-field="bossAfterImageMode"]');
    if (afterImageSelect) {
      const modes = ['bruta', 'devanecida', 'leve', 'forte', 'colorida', 'arco-íris'];
      const selectedModes = new Set(Array.isArray(health.bossAfterImageModes) ? health.bossAfterImageModes : health.bossAfterImageMode && health.bossAfterImageMode !== 'none' ? [health.bossAfterImageMode] : []);
      const controls = document.createElement('div');
      controls.className = 'sp-after-image-options';
      controls.setAttribute('aria-label', 'After-images do boss');
      controls.innerHTML = modes.map(mode => `<label><input type="checkbox" data-boss-afterimage value="${escape(mode)}" ${selectedModes.has(mode) ? 'checked' : ''}> ${escape(mode)}</label>`).join('');
      afterImageSelect.replaceWith(controls);
    }
  }

  function update(mutator) {
    api.updateHealth(mutator);
    render();
  }

  function moveEntry(id, offset) {
    const entries = turnEntries(api.getState().health);
    const from = entries.findIndex(entry => entry.id === id);
    const to = from + offset;
    if (from < 0 || to < 0 || to >= entries.length) return;
    const [entry] = entries.splice(from, 1);
    entries.splice(to, 0, entry);
    update(health => { health.turnOrder = entries.map(item => ({ id: item.id })); });
  }

  root.addEventListener('click', async event => {
    const button = event.target.closest('[data-action]');
    if (!button) return;
    const card = button.closest('[data-character-id]');
    const id = card?.dataset.characterId;
    if (button.dataset.action === 'save-sheet') {
      const sourceId = root.querySelector('[data-library-source]').value;
      const character = api.getState().health.characters.find(item => String(item.id) === String(sourceId));
      if (!character) { libraryMessage = 'Selecione uma ficha válida para salvar.'; render(); return; }
      const sheet = JSON.parse(JSON.stringify(character));
      delete sheet.id;
      delete sheet.linkedTokenId;
      sheetLibrary.unshift({ id: crypto.randomUUID(), name: character.name || 'Ficha sem nome', sheet });
      if (!saveSheetLibrary()) sheetLibrary.shift();
      render();
      return;
    }
    if (button.dataset.action === 'load-sheet') {
      const template = sheetLibrary.find(item => item.id === root.querySelector('[data-library-template]').value);
      const targetId = root.querySelector('[data-library-target]').value;
      if (!template || !api.getState().health.characters.some(item => String(item.id) === String(targetId))) {
        libraryMessage = 'Selecione uma ficha salva e uma ficha de destino.';
        render();
        return;
      }
      const sheet = JSON.parse(JSON.stringify(template.sheet));
      update(health => {
        const character = health.characters.find(item => String(item.id) === String(targetId));
        if (character) Object.assign(character, sheet, { id: character.id, linkedTokenId: character.linkedTokenId });
      });
      libraryMessage = `Ficha "${template.name}" carregada.`;
      render();
      return;
    }
    if (button.dataset.action === 'delete-sheet') {
      const templateId = root.querySelector('[data-library-template]').value;
      const index = sheetLibrary.findIndex(item => item.id === templateId);
      if (index < 0) { libraryMessage = 'Selecione uma ficha salva para excluir.'; render(); return; }
      const [removed] = sheetLibrary.splice(index, 1);
      if (!saveSheetLibrary()) sheetLibrary.splice(index, 0, removed);
      else libraryMessage = `Ficha "${removed.name}" excluída.`;
      render();
      return;
    }
    if (button.dataset.action === 'test-stat') {
      const field = card.querySelector('[data-test-stat]').value;
      const character = api.getState().health.characters.find(item => String(item.id) === String(id));
      const stat = testableStats.find(item => item[0] === field);
      const value = Number(character?.[field] ?? (field === 'forca' ? character?.forcaFisica : field === 'resistenciaPerfeita' ? character?.defesaP : 0)) || 0;
      const output = card.querySelector('[data-stat-result]');
      button.disabled = true;
      output.textContent = 'Rolando...';
      try {
        const roll = await window.StonePlateDice?.rollExpression(`1d20+${value}`);
        output.textContent = roll ? `${stat?.[1] || field}: ${rollTotal(roll)} (d20 + ${value})` : 'Não foi possível rolar o teste.';
      } catch (error) {
        console.error('Não foi possível rolar o teste da ficha.', error);
        output.textContent = 'Falha ao rolar o teste.';
      } finally {
        button.disabled = false;
      }
      return;
    }
    if (button.dataset.action === 'add-attack') {
      const nameInput = card.querySelector('[data-new-attack-name]');
      const expressionInput = card.querySelector('[data-new-attack-dice]');
      const name = nameInput.value.trim();
      const expression = expressionInput.value.replace(/\s+/g, '').toLowerCase();
      if (!name || !isValidDamageExpression(expression)) {
        libraryMessage = 'Informe o nome do golpe e uma expressão válida, como 2d6+1.';
        render();
        return;
      }
      const attack = {
        id: crypto.randomUUID(),
        name,
        damageExpression: expression,
        damageType: ['fisico', 'especial', 'bruto', 'verdadeiro', 'alma'].includes(card.querySelector('[data-new-attack-type]').value)
          ? card.querySelector('[data-new-attack-type]').value
          : 'fisico',
        damageForceType: card.querySelector('[data-new-attack-force-type]').value === 'especial' ? 'especial' : 'fisico'
      };
      update(health => {
        const character = health.characters.find(item => String(item.id) === String(id));
        if (character) (character.attacks ||= []).push(attack);
      });
      libraryMessage = '';
      render();
      return;
    }
    if (button.dataset.action === 'remove-attack') {
      const attackId = button.dataset.attackId;
      update(health => {
        const character = health.characters.find(item => String(item.id) === String(id));
        if (character) character.attacks = (character.attacks || []).filter(attack => String(attack.id) !== String(attackId));
      });
      return;
    }
    if (button.dataset.action === 'open-display') window.open('players.html', 'stone-plate-player-display');
    if (button.dataset.action === 'add-character') update(health => {
      if (health.characters.length >= 10) return;
      const index = health.characters.length;
      const name = `Personagem ${index + 1}`;
      api.addCharacter({ id: crypto.randomUUID(), name, vitalidade: 100, vitality: 100, vitalityMax: 100, lucidez: 100, lucidity: 100, lucidityMax: 100, agilidade: 10, forcaFisica: 10, forcaEspecial: 10, resistenciaFisica: 10, resistenciaEspecial: 10, resistenciaPerfeita: 0, intuicao: 10, persuasao: 10, criticalBonusPercent: 10, linkedTokenId: null, imageDataUrl: avatarDataUrl(name, index), emojiAuraEnabled: false, emojiAuraEmoji: '💥', forca: 10, forcaMult: 1, dado: 0, danoMult: 1, defesa: 0, defesaP: 0, defesaMult: 0, reducaoA: 0, reducaoD: 0, divisao: 1 });
    });
    if (button.dataset.action === 'remove-character') update(health => {
      health.characters = health.characters.filter(character => String(character.id) !== String(id));
      health.turnOrder = (health.turnOrder || []).filter(entry => entry.id !== characterEntryId({ id }));
      health.activeTurnIndex = Math.min(health.activeTurnIndex || 0, Math.max(0, health.characters.length));
    });
    if (button.dataset.action === 'move-up') moveEntry(button.closest('[data-turn-id]').dataset.turnId, -1);
    if (button.dataset.action === 'move-down') moveEntry(button.closest('[data-turn-id]').dataset.turnId, 1);
    if (button.dataset.action === 'next-turn') api.advanceTurn();
    if (button.dataset.action === 'apply-global-damage') {
      const damage = Math.max(0, Number(root.querySelector('[data-damage-input]').value) || 0);
      const emoji = root.querySelector('[data-damage-emoji]').value;
      update(health => { health.currentHp = Math.max(0, health.currentHp - damage); health.damageEmoji = emoji; health.damageEffect = { id: crypto.randomUUID(), damage, emoji }; });
    }
  });

  root.addEventListener('change', event => {
    const input = event.target;
    const card = input.closest('[data-character-id]');
    if (input.matches('[data-boss-afterimage]')) {
      update(health => {
        const selectedModes = new Set(Array.isArray(health.bossAfterImageModes) ? health.bossAfterImageModes : []);
        if (input.checked) selectedModes.add(input.value);
        else selectedModes.delete(input.value);
        health.bossAfterImageModes = [...selectedModes];
        health.bossAfterImageMode = health.bossAfterImageModes[0] || 'none';
      });
      return;
    }
    if (input.matches('[data-damage-emoji]')) {
      update(health => { health.damageEmoji = input.value; });
      return;
    }
    if (input.matches('[data-character-image]') && card && input.files?.[0]) {
      const reader = new FileReader();
      reader.onload = () => update(health => {
        const character = health.characters.find(item => String(item.id) === card.dataset.characterId);
        if (character) character.imageDataUrl = String(reader.result || '');
      });
      reader.readAsDataURL(input.files[0]);
      return;
    }
    if (input.matches('[data-health-field="imageDataUrl"]') && input.files?.[0]) {
      const reader = new FileReader();
      reader.onload = () => update(health => { health.imageDataUrl = String(reader.result || ''); });
      reader.readAsDataURL(input.files[0]);
      return;
    }
    if (card && input.dataset.characterField) {
      const id = card.dataset.characterId;
      const field = input.dataset.characterField;
      const value = input.type === 'checkbox' ? input.checked : input.value;
      update(health => {
        const character = health.characters.find(item => String(item.id) === String(id));
        if (!character) return;
        if (field === 'linkedTokenId') character[field] = value || null;
        else if (field === 'vitality' || field === 'vitalidade') {
            character.vitalidade = boundedStat('vitalidade', value);
          character.vitality = character.vitalidade;
        }
        else if (field === 'lucidity' || field === 'lucidez') {
            character.lucidez = boundedStat('lucidez', value);
          character.lucidity = character.lucidez;
        }
        else if (field === 'vitalityMax' || field === 'lucidityMax') {
            character[field] = Math.max(1, boundedStat(field, value));
          character[field === 'vitalityMax' ? 'vitalidadeMax' : 'lucidezMax'] = character[field];
        }
        else if (['agilidade', 'forcaFisica', 'forcaEspecial', 'resistenciaFisica', 'resistenciaEspecial', 'resistenciaPerfeita', 'intuicao', 'persuasao'].includes(field)) {
            character[field] = boundedStat(field, value);
          if (field === 'resistenciaPerfeita') character.defesaP = character.resistenciaPerfeita;
        }
        else if (field === 'criticalBonusPercent') character[field] = Math.max(0, Number(value) || 0);
        else if (['forca', 'forcaMult', 'dado', 'danoMult', 'defesa', 'defesaP', 'resistenciaPerfeita', 'defesaMult', 'reducaoA', 'reducaoD', 'divisao'].includes(field)) {
          if (field === 'divisao') character[field] = Math.max(1, Number(value) || 1);
          else if (field === 'defesaP' || field === 'resistenciaPerfeita') {
            const perfectValue = boundedStat('resistenciaPerfeita', value);
            character.resistenciaPerfeita = perfectValue;
            character.defesaP = perfectValue;
          }
          else character[field] = Number(value) || 0;
        }
        else character[field] = value;
      });
      return;
    }
    if (input.dataset.healthField) {
      const field = input.dataset.healthField;
      const value = input.type === 'checkbox' ? input.checked : input.value;
      update(health => {
        if (field === 'currentHp') health[field] = Math.max(0, Math.min(Number(value) || 0, health.maxHp));
        else if (field === 'maxHp') { health[field] = Math.max(1, Number(value) || 1); health.currentHp = Math.min(health.currentHp, health.maxHp); }
        else health[field] = value;
        if (field === 'bossAfterImageMode') health.bossAfterImageModes = value === 'none' ? [] : [value];
      });
    }
  });

  window.StonePlateCharacters = {
    mount(stonePlateApi) {
      api = stonePlateApi;
      api.subscribe(render);
      render();
    }
  };
})();
