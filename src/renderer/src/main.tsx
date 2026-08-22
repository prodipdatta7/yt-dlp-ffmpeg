import { render } from 'preact'
import { App } from './App'
import './styles/global.css'

const container = document.getElementById('app')
if (!container) throw new Error('Root element #app not found')

render(<App />, container)
