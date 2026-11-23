import ReactDOM from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './review.css';
import './biofeedback.css';
import './mobile.css';
ReactDOM.createRoot(document.getElementById('root')!).render(<App/>);
if ('serviceWorker' in navigator && import.meta.env.PROD && window.isSecureContext) {
  window.addEventListener('load',()=>{navigator.serviceWorker.register('/sw.js').catch(()=>{/* Installation status is shown in profile. */});});
}
