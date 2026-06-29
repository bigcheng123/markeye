/** NG 报警音（WebAudio，无需外部 wav） */

let _ctx = null;

export function playNgAlert() {
  try {
    _ctx = _ctx || new (window.AudioContext || window.webkitAudioContext)();
    const osc = _ctx.createOscillator();
    const gain = _ctx.createGain();
    osc.type = "square";
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(_ctx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, _ctx.currentTime + 0.4);
    osc.stop(_ctx.currentTime + 0.45);
  } catch {
    /* 静默失败 */
  }
}
