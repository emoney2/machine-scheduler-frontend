// src/index.js
import React from 'react';
import ReactDOM from 'react-dom';
import { BrowserRouter } from 'react-router-dom';
import "./axios-setup";
import axios from 'axios';
import App from './App';
import "./index.css";

// Always include cookies on API requests so the session stays alive
axios.defaults.withCredentials = true;     // ← and this

ReactDOM.render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
  document.getElementById('root')
);