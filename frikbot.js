'use strict'

// Telegram bot api
const Telegram = require('telegram-node-bot');
const TelegramBaseController = Telegram.TelegramBaseController;
const TextCommand = Telegram.TextCommand;
const RegexpCommand = Telegram.RegexpCommand;

const Q = require('q');
const request = require('request');
const fs = require('fs');
const s = require("underscore.string");
const _ = require("underscore");

var keys;
try {
  var keyStr = fs.readFileSync('./key_store.key', 'utf8').trim();

  var keys = JSON.parse(keyStr);

  console.log('Key file has read.');
} catch (e) {
  console.log('Key file not found: "key_store.key"', e);
  return;
}

const tg = new Telegram.Telegram(keys.telegram.bot_key, {});

console.log('Telegram frik bot has started...');

// Twitter API
var Twitter = require('twitter');
var twitterClient = new Twitter({
  consumer_key: keys.twitter.consumer_key,
  consumer_secret: keys.twitter.consumer_secret,
  access_token_key: keys.twitter.access_token_key,
  access_token_secret: keys.twitter.access_token_secret
});
// -- Twitter

var helpText = fs.readFileSync('./texts/helpTexts.txt', 'utf8');

// Help method to give usage information.
class HelpController extends TelegramBaseController {
  /**
   * @param {Scope} $
   */
  helpHandler($) {
    var opts = {
      disable_web_page_preview: true
    };
    $.sendMessage(helpText, opts);
  }

  get routes() {
    return {
      'helpCommand': 'helpHandler'
    }
  }
}
tg.router.when(new TextCommand('/help', 'helpCommand'), new HelpController());
tg.router.when(new TextCommand('/start', 'helpCommand'), new HelpController());

// A short-cut to call help controller.
const callHelp = function ($) {
  (new HelpController()).helpHandler($);
}

const textMatcher = /"(.*?)"/; // Use the second matched string to get string without quotes.
const urlMatcher = /(http|ftp|https):\/\/[\w-]+(\.[\w-]+)+([\w.,@?^=%&amp;:\/~+#-]*[\w@?^=%&amp;\/~+#-])?/ // Use the first matched string to get complete url string.

class FrikTextController extends TelegramBaseController {
  /**
   * @param {Scope} $
   */
  frikHandler($) {
    if ($.message._chat._id !== -1001040845247) {
      handleException($, {message: 'You can not use this bot in this group!'});
      return;
    }

    var commandText = s($.message.text).trim().clean().value();

    var text;
    var textMatch = commandText.match(textMatcher);
    if (textMatch && textMatch.length > 1) {
      text = textMatch[1];

      // Remove the text from the all command string to avoid conflict url value in the next step.
      commandText = commandText.replace(text,'');
    }

    var url;
    var urlMatch = commandText.match(urlMatcher);
    if (urlMatch && urlMatch[0]) {
      url = urlMatch[0];
    }

    if (!text) {
      callHelp($);
      return;
    }

    // Clean and format the sent text
    text = s(text).trim().clean().value();

    try {
      frikController($, text, url);
    } catch (error) {
      handleException($, error);
    }
  }

  get routes() {
    return {
      'frikCommand': 'frikHandler'
    }
  }
}
tg.router.when(new RegexpCommand(/frik/gi, 'frikCommand'), new FrikTextController());

// Exception handlig method. Logging the error and sends the error message to the chat window too.
var handleException = function($, error) {
  console.log(error);

  $.sendMessage(error.message);
};

const GENERIC_ERROR_MESSAGE = 'Error occured while sending the message! Please try again.\n/frikhelp';
const FILES_BOWL = __dirname + '/files';

// Main method
var frikController = function($, text, url) {
  console.log('/frik called with the parameters text:', text, 'url:', url);

  var deferredMedia = Q.defer();
  if (url) {
    var filename = FILES_BOWL + '/' + (new Date()).getTime() + '.' + url.split('.').pop();
    downloadImage(url, filename, function(errorMessage) {
      if (errorMessage) {
        console.log('File could not be downloaded: ', filename, ', Error Message: ', errorMessage);

        deferredMedia.reject(errorMessage);
      } else {
        console.log('File downloaded: ', filename);

        // Load your image
        var data = fs.readFileSync(filename);

        // Make post request on media endpoint. Pass file data as media parameter
        twitterClient.post('media/upload', {media: data}, function(error, media, response) {
          if (error) {
            deferredMedia.reject(error.message ? error.message : GENERIC_ERROR_MESSAGE);
          } else {
            // If successful, a media object will be returned.
            console.log('Media file posted...');

            fs.unlink(filename);

            deferredMedia.resolve(media);
          }
        });
      }
    });
  } else {
    deferredMedia.resolve();
  }

  deferredMedia.promise.then(function(media) {
    // Lets tweet it
    var status = {
      status: text
    }

    // If there is a media then add to the status
    if (media) {
      status.media_ids = media.media_id_string; // Pass the media id string
    }

    twitterClient.post('statuses/update', status, function(error, tweet, response) {
      if (error) {
        console.log('Error: ', error);

        $.sendMessage(error[0].message);
      } else {
        var message = 'Hooray! status updated. https://twitter.com/AnatolianFreak/status/' + tweet.id_str;

        console.log(message);

        var opts = {
          disable_web_page_preview: true
        };
        $.sendMessage(message, opts);
      }
    });
  }, function(errorMessage) {
    console.log('Error: ', errorMessage);

    $.sendMessage(errorMessage);
  })

};

// Downloads file and saves into the bowl directory.
var downloadImage = function(url, dest, cb) {
    var file = fs.createWriteStream(dest);

    var sendReq = request.get(url);
    // verify response code
    sendReq.on('response', function(response) {
        if (response.statusCode !== 200) {
            return cb('Response status was: ' + response.statusCode);
        }
    });
    // check for request errors
    sendReq.on('error', function (err) {
        fs.unlink(dest);

        if (cb) {
            return cb(err.message);
        }
    });
    sendReq.pipe(file);

    file.on('finish', function() {
        file.close(cb);  // close() is async, call cb after close completes.
    });
    file.on('error', function(err) { // Handle errors
        fs.unlink(dest); // Delete the file async. (But we don't check the result)

        if (cb) {
            return cb(err.message);
        }
    });
};
