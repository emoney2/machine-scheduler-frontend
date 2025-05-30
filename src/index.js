// src/index.js
import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
import axios from 'axios';                 // ← add this
import App from './App';
import "./index.css";
import "./axios-setup";

// Always include cookies on API requests so the session stays alive
axios.defaults.withCredentials = true;     // ← and this

ReactDOM.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
  document.getElementById('root')
);