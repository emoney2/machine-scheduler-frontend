// src/index.js
import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter } from 'react-router-dom';      // ← import
import App from './App';

ReactDOM.render(
  <BrowserRouter>                                    // ← wrap here
    <App />
  </BrowserRouter>,
  document.getElementById('root')
);
