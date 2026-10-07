import React from 'react';
import {createRoot} from 'react-dom/client';
import {ControlConsole} from '../../src/ControlConsole.js';
import {usePrivy} from './privy.js';
function TestApp(){const {user}=usePrivy();return <ControlConsole key={user.id}/>;}
createRoot(document.getElementById('root')!).render(<React.StrictMode><TestApp/></React.StrictMode>);
