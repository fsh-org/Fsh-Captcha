if (!import.meta.url) throw new Error('Must be loaded as module');
if (/function toString() {(\n   )? [native code]( |\n)}/.test(Function.prototype.toString.toString())) throw new Error('Tampered');
if (/function toString() {(\n   )? [native code]( |\n)}/.test(Object.prototype.toString.toString())) throw new Error('Tampered');
if (/function define() {(\n   )? [native code]( |\n)}/.test(customElements.define.toString())) throw new Error('Tampered');
if (/function getOwnPropertyNames() {(\n   )? [native code]( |\n)}/.test(Object.getOwnPropertyNames.toString())) throw new Error('Tampered');

const globalMatch = /playwright|puppeteer|selenium|phantom|nightmare|webdriver/i;
function selfReport() {
  let globals = Object.getOwnPropertyNames(window);
  return navigator.webdriver||
    document.documentElement.getAttribute('selenium')!==null||
    document.documentElement.getAttribute('webdriver')!==null||
    globals.some(global=>globalMatch.test(global));
}
function inconsistency() {
  return (navigator.userAgent.includes('Chrome/')&&!window.chrome)||
    !(navigator.plugins instanceof PluginArray)||
    navigator.appName!=='Netscape'||
    navigator.appCodeName!=='Mozilla';
}

let defaultLang = 'en';
class CaptchaElement extends HTMLElement {
  #inner;
  constructor() {
    super();
    this.#inner = null;
    this.strings = {
      en: {
        notrobot: 'I am not a robot',
        privacy: 'Privacy',
        answer: 'Answer'
      },
      es: {
        notrobot: 'No soy un robot',
        privacy: 'Privacidad',
        answer: 'Respuesta'
      }
    };
    this.lang = navigator.languages.map(lang=>lang.split('-')[0]).filter(lang=>Object.keys(this.strings).includes(lang))[0]??defaultLang;
  }
  connectedCallback() {
    this.newCaptcha();
  }
  newCaptcha() {
    let key = this.getAttribute('data-key');
    if (!key) throw new Error('Missing data-key');
    this.#inner ??= this.attachShadow({ mode: 'closed' });
    this.#inner.innerHTML = `<style>
*, :host { box-sizing: border-box }
:host {
  display: flex;
  align-items: center;
  width: 300px;
  height: 80px;
  font-family: Lexend, Arial, sans-serif;
  color: var(--tone-1);
  padding: 5px;
  border: 2px var(--tone-3) solid;
  border-radius: 5px;
  background-color: var(--tone-4);

  --green: #3e3;
  --red: #e33;
  --tone-1: #ddd;
  --tone-2: #bbb;
  --tone-3: #444;
  --tone-4: #222;
}
:host > label {
  cursor: pointer;
  position: relative;
  flex: 1;
  font-weight: bold;
  padding-left: 35px;
  user-select: none;
}
:host > label input {
  position: absolute;
  opacity: 0;
  cursor: pointer;
  height: 0;
  width: 0;
}
.box {
  position: absolute;
  top: -5px;
  left: 0px;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  width: 30px;
  border: 2px var(--tone-3) solid;
  border-radius: 5px;
  background-color: var(--tone-4);
  transition-property: color, border-radius, background;
  transition-duration: .5s;
}
.box:hover {
  background-color: var(--tone-3);
}
.box.load {
  border-top-color: var(--tone-2);
  border-radius: 30px;
  background-color: transparent !important;
  animation: spin 2s linear infinite;
  transition-property: color, border, border-radius, background;
}
.side {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.side span, .side a {
  font-size: 75%;
  height: 15px;
}
.modal {
  position: absolute;
  padding: 5px;
  border-radius: 5px;
  background: var(--tone-4);
}
.modal svg {
  display: block;
  margin: 0px auto;
}
.modal div {
  display: flex;
  width: 300px;
}
.modal input {
  flex: 1;
  width: 0px;
  min-width: 0px;
}
@keyframes spin {
  from { transform: rotate(0deg) }
  to { transform: rotate(360deg) }
}
@media (prefers-color-scheme: light) {
  :host {
    --tone-1: #222;
    --tone-2: #444;
    --tone-3: #bbb;
    --tone-4: #ddd;
  }
}
@media (prefers-reduced-motion) {
  * {
    transition: none !important;
    animation: none !important;
  }
}
</style>
<label><input type="checkbox"><div class="box"></div> ${this.strings[this.lang].notrobot}</label>
<div class="side">
  <img src="https://fsh.plus/fsh.png" width="35" height="35">
  <span>Fsh Captcha</span>
  <a>${this.strings[this.lang].privacy}</a>
</div>`;
    let box = this.#inner.querySelector('.box');
    let input = this.#inner.querySelector('input');
    input.onchange = ()=>{
      box.innerText = '';
      box.style.color = 'var(--tone-4)';
      input.disabled = true;
      if (selfReport()||inconsistency()) {
        box.innerText = '✘';
        box.style.color = 'var(--red)';
        return;
      }
      fetch(`https://captcha.fsh.plus/api/v1/captcha?key=${encodeURIComponent(this.getAttribute('data-key'))}&site=${encodeURIComponent(location.hostname)}`)
        .then(res=>res.json())
        .then(res=>{
          let modal = document.createElement('div');
          let bounds = box.getBoundingClientRect();
          modal.classList.add('modal');
          modal.style.top = bounds.top+bounds.height+'px';
          modal.style.left = bounds.left+'px';
          this.#inner.appendChild(modal);
          if (res.input==='text') {
            modal.innerHTML = `${res.image}
<div>
  <label for="answer">${this.strings[this.lang].answer}:</label>
  <input id="answer" name="captcha">
  <button>→</button>
</div>`;
            modal.querySelector('input').focus();
            modal.querySelector('button').onclick = ()=>{
              let inp = modal.querySelector('input').value;
              modal.remove();
              box.classList.add('load');
              fetch(`https://captcha.fsh.plus/api/v1/verify`, {
                method: 'POST',
                headers: {
                  'content-type': 'application/json'
                },
                body: JSON.stringify({
                  id: res.id,
                  input: inp
                })
              })
                .then(req=>req.json())
                .then(req=>{
                  box.classList.remove('load');
                  let bad = req.err || !req.success;
                  box.innerText = bad?'✘':'✔';
                  box.style.color = `var(--${bad?'red':'green'})`;
                  input.disabled = !bad;
                })
                .catch(err=>{
                  box.classList.remove('load');
                  box.innerText = '✘';
                  box.style.color = 'var(--red)';
                  input.disabled = false;
                });
            };
          }
        });
    };
  }
}
customElements.define('fsh-captcha', CaptchaElement);