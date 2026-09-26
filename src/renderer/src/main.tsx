import { render } from 'preact'
import { App } from './App'
import { observeMotionVisibility } from './utils/motionVisibility'
import './styles/global.css'
import './styles/motion.css'

const container = document.getElementById('app')
if (!container) throw new Error('Root element #app not found')

const stopObservingMotion = observeMotionVisibility()
if (import.meta.hot) import.meta.hot.dispose(stopObservingMotion)

render(<App />, container)
