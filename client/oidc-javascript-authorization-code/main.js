import './style.css'
import { onLoad } from './login.js'

document.querySelector('#app').innerHTML = `
  <div>
    <h1>Login</h1>
    <div id="container"></div>
  </div>
`

onLoad(document.querySelector('#container'))
