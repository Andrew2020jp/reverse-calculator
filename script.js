(() => {
  'use strict';

  const HISTORY_KEY = 'reverse-calculator-history-v1';
  const EPSILON = 1e-10;

  const form = document.querySelector('#solver-form');
  const expressionInput = document.querySelector('#expression');
  const clearButton = document.querySelector('#clear-button');
  const clearHistoryButton = document.querySelector('#clear-history');
  const formError = document.querySelector('#form-error');
  const keypad = document.querySelector('#keypad');
  const answerStatus = document.querySelector('#answer-status');
  const answerValue = document.querySelector('.answer-value');
  const answerPercent = document.querySelector('#answer-percent');
  const answerNote = document.querySelector('#answer-note');
  const newExpressionButton = document.querySelector('#new-expression-button');
  const steps = document.querySelector('#steps');
  const stepsList = document.querySelector('#steps-list');
  const historyList = document.querySelector('#history-list');
  const cameraButton = document.querySelector('#camera-button');
  const cameraPanel = document.querySelector('#camera-panel');
  const cameraCloseButton = document.querySelector('#camera-close');
  const cameraVideo = document.querySelector('#camera-video');
  const cameraCanvas = document.querySelector('#camera-canvas');
  const cameraCaptureButton = document.querySelector('#camera-capture');
  const cameraStopButton = document.querySelector('#camera-stop');
  const cameraStatus = document.querySelector('#camera-status');

  const examples = document.querySelectorAll('.example-chip');
  const isTouchDevice =
    window.matchMedia?.('(pointer: coarse)').matches || Number(navigator.maxTouchPoints) > 0;
  let cameraStream = null;
  let cameraRequestId = 0;
  let ocrLibraryPromise = null;
  let ocrWorkerPromise = null;
  let ocrWorker = null;
  let cameraRecognitionInProgress = false;

  if (isTouchDevice) {
    expressionInput.readOnly = true;
    expressionInput.setAttribute('inputmode', 'none');
  }

  function setCameraStatus(message, isError = false) {
    cameraStatus.textContent = message;
    cameraStatus.classList.toggle('is-error', isError);
  }

  function stopCamera() {
    cameraStream?.getTracks().forEach((track) => track.stop());
    cameraStream = null;
    cameraVideo.srcObject = null;
    cameraCaptureButton.disabled = true;
  }

  function closeCamera() {
    cameraRequestId += 1;
    stopCamera();
    cameraPanel.hidden = true;
    cameraButton.setAttribute('aria-expanded', 'false');
    cameraButton.disabled = false;
  }

  function loadOcrLibrary() {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (ocrLibraryPromise) return ocrLibraryPromise;

    ocrLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@6.0.1/dist/tesseract.min.js';
      script.async = true;
      script.onload = () => {
        if (window.Tesseract) {
          resolve(window.Tesseract);
        } else {
          reject(new Error('文字認識ライブラリを読み込めませんでした。'));
        }
      };
      script.onerror = () => reject(new Error('文字認識ライブラリの読み込みに失敗しました。'));
      document.head.append(script);
    });

    return ocrLibraryPromise;
  }

  async function getOcrWorker() {
    if (ocrWorker) return ocrWorker;
    if (!ocrWorkerPromise) {
      ocrWorkerPromise = loadOcrLibrary()
        .then((tesseract) =>
          tesseract.createWorker('eng', 1, {
            logger: (message) => {
              if (message.status === 'recognizing text' && Number.isFinite(message.progress)) {
                setCameraStatus(`文字を解析中… ${Math.round(message.progress * 100)}%`);
              } else if (message.status) {
                setCameraStatus('文字認識を準備中…');
              }
            },
          }),
        )
        .then((worker) => {
          ocrWorker = worker;
          return worker;
        });
    }

    try {
      return await ocrWorkerPromise;
    } catch (error) {
      ocrWorkerPromise = null;
      throw error;
    }
  }

  function normalizeRecognizedExpression(rawText) {
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const source = lines.find((line) => /[=＝]/.test(line)) || rawText.replace(/\r?\n/g, ' ');
    const equalIndex = source.search(/[=＝]/);
    if (equalIndex < 0) return '';

    const normalizeSide = (side) => {
      const candidates = side
        .match(/[0-9?xX□()[\]+\-*/.%\s]+/g)
        ?.map((candidate) => candidate.trim())
        .filter(Boolean)
        .sort((left, right) => right.length - left.length);
      const candidate = candidates?.[0] || side;

      return candidate
        .replace(/\[\s*\]/g, '□')
        .replace(/[▢◻◼⬜☐]/g, '□')
        .replace(/[＋]/g, '+')
        .replace(/[−ー–—]/g, '-')
        .replace(/[×✕＊]/g, '*')
        .replace(/[÷／]/g, '/')
        .replace(/[．]/g, '.')
        .replace(/[^0-9?xX□().%+\-*/]/g, '');
    };

    const left = normalizeSide(source.slice(0, equalIndex));
    const right = normalizeSide(source.slice(equalIndex + 1));
    if (!left || !right || !/[□?xX]/.test(`${left}${right}`)) return '';

    return `${left}=${right}`;
  }

  function captureCameraFrame() {
    if (!cameraVideo.videoWidth || !cameraVideo.videoHeight) {
      throw new Error('カメラの映像がまだ準備できていません。');
    }

    const maxWidth = 1600;
    const scale = Math.min(1, maxWidth / cameraVideo.videoWidth);
    cameraCanvas.width = Math.round(cameraVideo.videoWidth * scale);
    cameraCanvas.height = Math.round(cameraVideo.videoHeight * scale);
    const context = cameraCanvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('カメラ画像を処理できませんでした。');

    context.filter = 'grayscale(1) contrast(1.2)';
    context.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);
    context.filter = 'none';
    return cameraCanvas;
  }

  async function recognizeCameraExpression() {
    if (cameraRecognitionInProgress) return;

    cameraRecognitionInProgress = true;
    cameraCaptureButton.disabled = true;
    setCameraStatus('画像を準備中…');

    try {
      const frame = captureCameraFrame();
      const worker = await getOcrWorker();
      setCameraStatus('文字を解析中…');
      const result = await worker.recognize(frame);
      const expression = normalizeRecognizedExpression(result.data.text);

      if (!expression) {
        throw new Error('式を読み取れませんでした。□・x・? を含む式を枠内に写してください。');
      }

      expressionInput.value = expression;
      expressionInput.dispatchEvent(new Event('input', { bubbles: true }));
      form.requestSubmit();

      if (answerStatus.classList.contains('is-success')) {
        closeCamera();
      } else {
        setCameraStatus(`読み取った式「${displayExpression(expression)}」を確認してください。`, true);
      }
    } catch (error) {
      setCameraStatus(
        error instanceof Error ? error.message : 'カメラ画像を読み取れませんでした。',
        true,
      );
    } finally {
      cameraRecognitionInProgress = false;
      if (!cameraPanel.hidden && cameraStream) cameraCaptureButton.disabled = false;
    }
  }

  async function openCamera() {
    const requestId = ++cameraRequestId;
    cameraPanel.hidden = false;
    cameraButton.setAttribute('aria-expanded', 'true');
    cameraButton.disabled = true;
    stopCamera();
    setCameraStatus('カメラを起動しています…');

    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('このブラウザではカメラを利用できません。', true);
      cameraButton.disabled = false;
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          height: { ideal: 720 },
          width: { ideal: 1280 },
        },
      });

      if (requestId !== cameraRequestId || cameraPanel.hidden) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      cameraStream = stream;
      cameraVideo.srcObject = stream;
      await cameraVideo.play();
      cameraCaptureButton.disabled = false;
      setCameraStatus('撮影できます。式を枠内に合わせてください。');
    } catch (error) {
      const message = error?.name === 'NotAllowedError'
        ? 'カメラの使用を許可してください。'
        : 'カメラを起動できませんでした。';
      setCameraStatus(message, true);
    } finally {
      if (requestId === cameraRequestId) cameraButton.disabled = false;
    }
  }

  function nearlyZero(value) {
    return Math.abs(value) < EPSILON;
  }

  function formatNumber(value) {
    const safeValue = nearlyZero(value) ? 0 : value;
    const rounded = Number(safeValue.toFixed(10));

    if (!Number.isFinite(rounded)) {
      return String(rounded);
    }

    return new Intl.NumberFormat('ja-JP', {
      maximumFractionDigits: 10,
      useGrouping: false,
    }).format(rounded);
  }

  function approximateFraction(value) {
    const sign = value < 0 ? -1 : 1;
    const target = Math.abs(value);
    const maxDenominator = 10000;
    const tolerance = 1e-9;
    let remainder = target;
    let previousNumerator = 0;
    let numerator = 1;
    let previousDenominator = 1;
    let denominator = 0;
    let bestNumerator = Math.round(target);
    let bestDenominator = 1;
    let bestError = Math.abs(target - bestNumerator);

    for (let iteration = 0; iteration < 32; iteration += 1) {
      const integerPart = Math.floor(remainder);
      const nextNumerator = integerPart * numerator + previousNumerator;
      const nextDenominator = integerPart * denominator + previousDenominator;

      if (nextDenominator > maxDenominator) break;

      const error = Math.abs(target - nextNumerator / nextDenominator);
      if (error < bestError) {
        bestNumerator = nextNumerator;
        bestDenominator = nextDenominator;
        bestError = error;
      }
      if (error < tolerance) break;

      const fractionalPart = remainder - integerPart;
      if (nearlyZero(fractionalPart)) break;

      previousNumerator = numerator;
      numerator = nextNumerator;
      previousDenominator = denominator;
      denominator = nextDenominator;
      remainder = 1 / fractionalPart;
    }

    return {
      numerator: sign * bestNumerator,
      denominator: bestDenominator,
      error: bestError,
    };
  }

  function formatFraction(value) {
    if (!Number.isFinite(value) || nearlyZero(value) || nearlyZero(value - Math.round(value))) {
      return null;
    }

    const fraction = approximateFraction(value);
    if (fraction.denominator === 1 || fraction.error > 1e-8) return null;

    const sign = fraction.numerator < 0 ? '−' : '';
    return `${sign}${Math.abs(fraction.numerator)}/${fraction.denominator}`;
  }

  function formatMathValue(value) {
    return formatFraction(value) || formatNumber(value);
  }

  function formatPercent(value) {
    return `${formatNumber(value * 100)}%`;
  }

  function formatSigned(value) {
    if (value < -EPSILON) {
      return `− ${formatMathValue(Math.abs(value))}`;
    }
    return formatMathValue(value);
  }

  function normalizeExpression(value) {
    return value
      .trim()
      .replace(/[＝=]/g, '=')
      .replace(/[＋]/g, '+')
      .replace(/[−ー–—]/g, '-')
      .replace(/[×✕＊]/g, '*')
      .replace(/[÷／]/g, '/')
      .replace(/[０-９]/g, (character) => String.fromCharCode(character.charCodeAt(0) - 0xff10 + 0x30))
      .replace(/[．]/g, '.')
      .replace(/\s+/g, '');
  }

  function tokenize(expression) {
    const tokens = [];
    let index = 0;

    while (index < expression.length) {
      const character = expression[index];

      if (/\d|\./.test(character)) {
        const start = index;
        let decimalCount = 0;
        while (index < expression.length && /\d|\./.test(expression[index])) {
          if (expression[index] === '.') decimalCount += 1;
          index += 1;
        }

        const rawNumber = expression.slice(start, index);
        if (decimalCount > 1 || rawNumber === '.') {
          throw new Error('数字の書き方を確認してください。');
        }

        tokens.push({ type: 'number', value: Number(rawNumber) });
        continue;
      }

      if (character === '□' || character === '?' || character === 'x' || character === 'X') {
        tokens.push({ type: 'unknown' });
        index += 1;
        continue;
      }

      if ('+-*/()%'.includes(character)) {
        tokens.push({ type: character });
        index += 1;
        continue;
      }

      throw new Error(`「${character}」は使えない記号です。`);
    }

    if (tokens.length === 0) {
      throw new Error('式を入力してください。');
    }

    return tokens;
  }

  class ExpressionParser {
    constructor(expression) {
      this.tokens = tokenize(expression);
      this.position = 0;
    }

    current() {
      return this.tokens[this.position];
    }

    consume(type) {
      if (this.current()?.type !== type) return false;
      this.position += 1;
      return true;
    }

    parse() {
      const result = this.parseExpression();
      if (this.position !== this.tokens.length) {
        throw new Error('式の順番や括弧を確認してください。');
      }
      return result;
    }

    parseExpression() {
      let result = this.parseTerm();

      while (this.current()?.type === '+' || this.current()?.type === '-') {
        const operator = this.current().type;
        this.position += 1;
        const right = this.parseTerm();
        result = operator === '+' ? add(result, right) : subtract(result, right);
      }

      return result;
    }

    parseTerm() {
      let result = this.parseFactor();

      while (this.current()?.type === '*' || this.current()?.type === '/') {
        const operator = this.current().type;
        this.position += 1;
        const right = this.parseFactor();
        result = operator === '*' ? multiply(result, right) : divide(result, right);
      }

      return result;
    }

    parseFactor() {
      if (this.consume('+')) return this.parseFactor();
      if (this.consume('-')) return scale(this.parseFactor(), -1);

      let result;
      if (this.consume('(')) {
        result = this.parseExpression();
        if (!this.consume(')')) {
          throw new Error('括弧が閉じられていません。');
        }
      } else {
        const token = this.current();
        if (!token) {
          throw new Error('式が途中で終わっています。');
        }

        if (token.type === 'number') {
          this.position += 1;
          result = { coefficient: 0, constant: token.value };
        } else if (token.type === 'unknown') {
          this.position += 1;
          result = { coefficient: 1, constant: 0 };
        } else {
          throw new Error('数字または□から式を始めてください。');
        }
      }

      if (this.consume('%')) {
        result = scale(result, 0.01);
      }

      return result;
    }
  }

  function add(left, right) {
    return {
      coefficient: left.coefficient + right.coefficient,
      constant: left.constant + right.constant,
    };
  }

  function subtract(left, right) {
    return {
      coefficient: left.coefficient - right.coefficient,
      constant: left.constant - right.constant,
    };
  }

  function scale(value, factor) {
    return {
      coefficient: value.coefficient * factor,
      constant: value.constant * factor,
    };
  }

  function multiply(left, right) {
    const leftHasUnknown = !nearlyZero(left.coefficient);
    const rightHasUnknown = !nearlyZero(right.coefficient);

    if (leftHasUnknown && rightHasUnknown) {
      throw new Error('□同士の掛け算は、まだ対応していません。');
    }

    if (leftHasUnknown) return scale(left, right.constant);
    if (rightHasUnknown) return scale(right, left.constant);
    return { coefficient: 0, constant: left.constant * right.constant };
  }

  function divide(left, right) {
    if (!nearlyZero(right.coefficient)) {
      throw new Error('□を割る式は、分母を含むため対応していません。');
    }
    if (nearlyZero(right.constant)) {
      throw new Error('0では割れません。');
    }
    return scale(left, 1 / right.constant);
  }

  function formatAffine(value) {
    const coefficient = nearlyZero(value.coefficient) ? 0 : value.coefficient;
    const constant = nearlyZero(value.constant) ? 0 : value.constant;

    if (coefficient === 0) return formatMathValue(constant);

    let result = '';
    if (coefficient === 1) {
      result = '□';
    } else if (coefficient === -1) {
      result = '−□';
    } else {
      result = `${formatMathValue(coefficient)} × □`;
    }

    if (constant > EPSILON) result += ` + ${formatMathValue(constant)}`;
    if (constant < -EPSILON) result += ` − ${formatMathValue(Math.abs(constant))}`;
    return result;
  }

  function displayExpression(value) {
    return value
      .replace(/\*/g, ' × ')
      .replace(/\//g, ' ÷ ')
      .replace(/-/g, ' − ')
      .replace(/\+/g, ' + ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function splitEquation(expression) {
    const equalSigns = (expression.match(/=/g) || []).length;
    if (equalSigns !== 1) {
      throw new Error('「＝」を1つ入れて、左右に式を作ってください。');
    }

    const [left, right] = expression.split('=');
    if (!left || !right) {
      throw new Error('「＝」の左右に式を入力してください。');
    }

    return { left, right };
  }

  function parseNumberLiteral(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) {
      throw new Error('数字の書き方を確認してください。');
    }
    return number;
  }

  function solveDirectDivision(normalized, original) {
    const numberPattern = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
    const unknownPattern = '[□?xX]';
    const pattern = new RegExp(
      `^(${numberPattern})\\/(?:\\(?${unknownPattern}\\)?)=(${numberPattern})$`,
    );
    const match = normalized.match(pattern);

    if (!match) return null;

    const numerator = parseNumberLiteral(match[1]);
    const target = parseNumberLiteral(match[2]);
    if (nearlyZero(target)) {
      throw new Error('0になる割り算からは、□を1つに決められません。');
    }

    const value = numerator / target;
    if (nearlyZero(value)) {
      throw new Error('割る数を0にはできないため、この式の□は決まりません。');
    }

    return {
      kind: 'direct-division',
      value,
      normalized,
      original: original.trim(),
      numerator,
      target,
    };
  }

  function solveUnknownDenominator(leftExpression, rightExpression, normalized, original) {
    const denominatorPattern = /\/(?:\(?[□?xX]\)?)$/;
    if (!denominatorPattern.test(leftExpression)) return null;

    const slashIndex = leftExpression.lastIndexOf('/');
    const numeratorExpression = leftExpression.slice(0, slashIndex);
    if (!numeratorExpression) return null;

    const numerator = new ExpressionParser(numeratorExpression).parse();
    const target = new ExpressionParser(rightExpression).parse();

    if (!nearlyZero(numerator.coefficient) || !nearlyZero(target.coefficient)) {
      return null;
    }

    if (nearlyZero(target.constant)) {
      throw new Error('0になる割り算からは、□を1つに決められません。');
    }

    if (nearlyZero(numerator.constant)) {
      throw new Error('この式を満たす□はありません。');
    }

    const value = numerator.constant / target.constant;
    if (!Number.isFinite(value) || nearlyZero(value)) {
      throw new Error('割る数を0にはできないため、この式の□は決まりません。');
    }

    return {
      kind: 'division-with-unknown-denominator',
      value,
      normalized,
      original: original.trim(),
      numerator: numerator.constant,
      target: target.constant,
    };
  }

  function solve(expression) {
    const normalized = normalizeExpression(expression);
    if (!normalized) {
      throw new Error('式を入力してください。');
    }

    const directDivision = solveDirectDivision(normalized, expression);
    if (directDivision) return directDivision;

    const { left: leftExpression, right: rightExpression } = splitEquation(normalized);
    const unknownDenominator = solveUnknownDenominator(
      leftExpression,
      rightExpression,
      normalized,
      expression,
    );
    if (unknownDenominator) return unknownDenominator;

    const left = new ExpressionParser(leftExpression).parse();
    const right = new ExpressionParser(rightExpression).parse();

    if (nearlyZero(left.coefficient) && nearlyZero(right.coefficient)) {
      throw new Error(
        nearlyZero(left.constant - right.constant)
          ? '□を1つに決められない式です。'
          : 'この式を満たす□はありません。',
      );
    }

    const coefficient = left.coefficient - right.coefficient;
    const constant = right.constant - left.constant;

    if (nearlyZero(coefficient)) {
      throw new Error('この式では□の値を1つに決められません。');
    }

    const value = constant / coefficient;
    if (!Number.isFinite(value)) {
      throw new Error('計算結果が大きすぎます。');
    }

    return {
      value,
      normalized,
      left,
      right,
      coefficient,
      constant,
      original: expression.trim(),
    };
  }

  function renderSteps(result) {
    const valueText = formatMathValue(result.value);
    const decimalText = formatNumber(result.value);
    let stepData;

    if (
      result.kind === 'direct-division' ||
      result.kind === 'division-with-unknown-denominator'
    ) {
      const numeratorText = formatMathValue(result.numerator);
      const targetText = formatMathValue(result.target);
      stepData = [
        {
          label: '式を変形',
          expression: `${numeratorText} ＝ ${targetText} × □`,
        },
        {
          label: '□を求める',
          expression: `□ ＝ ${numeratorText} ÷ ${targetText}`,
        },
        { label: '計算結果', expression: `□ ＝ ${valueText}` },
      ];
    } else {
      const leftText = formatAffine(result.left);
      const rightText = formatAffine(result.right);
      const coefficientText = formatMathValue(result.coefficient);
      const constantText = formatSigned(result.constant);
      stepData = [
        { label: '左右の式を整理', expression: `${leftText} ＝ ${rightText}` },
        { label: '□の項をまとめる', expression: `${coefficientText} × □ ＝ ${constantText}` },
        {
          label: '係数で割る',
          expression:
            nearlyZero(result.coefficient - 1)
              ? `□ ＝ ${constantText}`
              : `□ ＝ ${constantText} ÷ ${formatMathValue(result.coefficient)}`,
        },
      ];
    }

    stepsList.replaceChildren(
      ...stepData.map((step, index) => {
        const item = document.createElement('li');
        const content = document.createElement('div');
        const label = document.createElement('span');
        const equation = document.createElement('strong');

        label.className = 'step-label';
        label.textContent = `${index + 1}. ${step.label}`;
        equation.className = 'step-equation';
        equation.textContent = step.expression;
        content.append(label, equation);
        item.append(content);
        return item;
      }),
    );

    steps.hidden = false;
    answerNote.textContent = formatFraction(result.value)
      ? `分数で表示しています。小数では約 ${decimalText} です。`
      : `計算の結果、□には ${valueText} が入ります。`;
  }

  function setError(message) {
    formError.textContent = message;
    expressionInput.setAttribute('aria-invalid', 'true');
    answerStatus.textContent = '確認が必要';
    answerStatus.className = 'answer-status is-error';
    answerValue.textContent = '—';
    answerValue.className = 'answer-value answer-value--placeholder';
    answerPercent.hidden = true;
    newExpressionButton.hidden = true;
    answerNote.textContent = '入力を見直して、もう一度試してください。';
    steps.hidden = true;
  }

  function setWaiting() {
    formError.textContent = '';
    expressionInput.removeAttribute('aria-invalid');
    answerStatus.textContent = '待機中';
    answerStatus.className = 'answer-status';
    answerValue.textContent = '—';
    answerValue.className = 'answer-value answer-value--placeholder';
    answerPercent.hidden = true;
    newExpressionButton.hidden = true;
    answerNote.textContent = '式を入力すると、ここに答えが表示されます。';
    steps.hidden = true;
  }

  function setSuccess(result) {
    const valueText = formatNumber(result.value);
    const fractionText = formatFraction(result.value);
    const shouldShowPercent =
      result.normalized.includes('%') || Math.abs(result.value) < 1 - EPSILON;
    formError.textContent = '';
    expressionInput.removeAttribute('aria-invalid');
    answerStatus.textContent = '計算完了';
    answerStatus.className = 'answer-status is-success';
    answerValue.textContent = fractionText || valueText;
    answerValue.className = fractionText ? 'answer-value answer-value--fraction' : 'answer-value';
    answerPercent.textContent = shouldShowPercent
      ? `百分率表示：${formatPercent(result.value)}`
      : '';
    answerPercent.hidden = !shouldShowPercent;
    newExpressionButton.hidden = false;
    renderSteps(result);
    saveHistory({ expression: displayExpression(result.original), value: valueText });
    renderHistory();
  }

  function updateInputValue(
    value,
    selectionStart,
    selectionEnd = selectionStart,
    { focus = true } = {},
  ) {
    expressionInput.value = value;
    expressionInput.setSelectionRange(selectionStart, selectionEnd);
    expressionInput.dispatchEvent(new Event('input', { bubbles: true }));
    if (focus) expressionInput.focus();
  }

  function insertKey(key, { focus = true } = {}) {
    if (answerStatus.classList.contains('is-success')) {
      expressionInput.value = '';
      setWaiting();
    }

    const value = expressionInput.value;
    const start = expressionInput.selectionStart ?? value.length;
    const end = expressionInput.selectionEnd ?? value.length;
    const nextValue = value.slice(0, start) + key + value.slice(end);
    updateInputValue(nextValue, start + key.length, start + key.length, { focus });
  }

  function removeKey({ focus = true } = {}) {
    const value = expressionInput.value;
    let start = expressionInput.selectionStart ?? value.length;
    const end = expressionInput.selectionEnd ?? value.length;

    if (start === end && start > 0) start -= 1;
    if (start === end) return;

    updateInputValue(value.slice(0, start) + value.slice(end), start, start, { focus });
  }

  function clearExpression({ focus = true } = {}) {
    expressionInput.value = '';
    setWaiting();
    if (focus) {
      expressionInput.focus();
    } else {
      expressionInput.blur();
    }
  }

  function readHistory() {
    try {
      const stored = localStorage.getItem(HISTORY_KEY);
      const parsed = stored ? JSON.parse(stored) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function saveHistory(item) {
    const history = readHistory().filter(
      (entry) => entry.expression !== item.expression || entry.value !== item.value,
    );
    history.unshift(item);

    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(0, 5)));
    } catch {
      // Private browsingなどで保存できない場合も、計算自体は継続します。
    }
  }

  function renderHistory() {
    const history = readHistory();
    if (history.length === 0) {
      historyList.innerHTML = '<p class="empty-history">まだ計算履歴はありません。</p>';
      return;
    }

    const items = document.createElement('div');
    items.className = 'history-items';
    items.append(
      ...history.map((item) => {
        const button = document.createElement('button');
        const expression = document.createElement('span');
        const value = document.createElement('span');

        button.type = 'button';
        button.className = 'history-item';
        button.title = `${item.expression} を再入力`;
        expression.className = 'history-expression';
        expression.textContent = item.expression;
        value.className = 'history-result';
        value.textContent = `□ = ${item.value}`;
        button.append(expression, value);
        button.addEventListener('click', () => {
          expressionInput.value = item.expression;
          expressionInput.focus();
          form.requestSubmit();
        });
        return button;
      }),
    );
    historyList.replaceChildren(items);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      const result = solve(expressionInput.value);
      setSuccess(result);
    } catch (error) {
      setError(error instanceof Error ? error.message : '式を確認してください。');
    }
  });

  expressionInput.addEventListener('input', () => {
    if (
      expressionInput.getAttribute('aria-invalid') === 'true' ||
      answerStatus.classList.contains('is-success')
    ) {
      setWaiting();
    }
  });

  clearButton.addEventListener('click', () => {
    clearExpression();
  });

  newExpressionButton.addEventListener('click', () => {
    clearButton.click();
  });

  clearHistoryButton.addEventListener('click', () => {
    try {
      localStorage.removeItem(HISTORY_KEY);
    } catch {
      // 保存領域が使えない環境では表示だけ更新します。
    }
    renderHistory();
  });

  examples.forEach((example) => {
    example.addEventListener('click', () => {
      expressionInput.value = example.dataset.expression || '';
      expressionInput.focus();
      form.requestSubmit();
    });
  });

  keypad.addEventListener('click', (event) => {
    const button = event.target.closest('.keypad-key');
    if (!button) return;

    const action = button.dataset.action;
    if (action === 'clear') {
      clearExpression({ focus: false });
      return;
    }
    if (action === 'backspace') {
      removeKey({ focus: false });
      expressionInput.blur();
      return;
    }
    if (action === 'submit') {
      expressionInput.blur();
      form.requestSubmit();
      return;
    }
    if (button.dataset.key) {
      insertKey(button.dataset.key, { focus: false });
      expressionInput.blur();
    }
  });

  cameraButton.addEventListener('click', () => {
    if (cameraPanel.hidden || !cameraStream) {
      openCamera();
    } else {
      closeCamera();
    }
  });

  cameraCloseButton.addEventListener('click', closeCamera);
  cameraStopButton.addEventListener('click', closeCamera);
  cameraCaptureButton.addEventListener('click', recognizeCameraExpression);

  window.addEventListener('pagehide', () => {
    closeCamera();
    ocrWorker?.terminate();
    ocrWorker = null;
    ocrWorkerPromise = null;
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      clearButton.click();
    }
  });

  renderHistory();
})();

