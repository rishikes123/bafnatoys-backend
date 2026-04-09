const { Expo } = require('expo-server-sdk');

// Create a new Expo SDK client
let expo = new Expo();

/**
 * Sends a push notification to one or more Expo push tokens.
 * @param {Array<string>} tokens - Array of Expo push tokens.
 * @param {string} title - The title of the notification.
 * @param {string} body - The body of the notification.
 * @param {Object} data - Optional data payload for the notification.
 */
const sendPushNotification = async (tokens, title, body, data = {}) => {
  let messages = [];
  
  // Filter for valid Expo push tokens
  for (let pushToken of tokens) {
    if (!Expo.isExpoPushToken(pushToken)) {
      console.error(`Push token ${pushToken} is not a valid Expo push token`);
      continue;
    }

    messages.push({
      to: pushToken,
      sound: 'default',
      title: title,
      body: body,
      data: data,
    });
  }

  // Batch the messages to send them efficiently
  let chunks = expo.chunkPushNotifications(messages);
  let tickets = [];
  
  for (let chunk of chunks) {
    try {
      console.log(`Sending chunk of ${chunk.length} notifications...`);
      let ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      console.log('Tickets received:', ticketChunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error('Error sending notification chunk:', error);
    }
  }

  // Optional: You can handle tickets to check for errors/receipts later
  return tickets;
};

module.exports = { sendPushNotification };
