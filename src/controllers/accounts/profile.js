'use strict';

var nconf = require('nconf');
var async = require('async');

const db = require('../../database');
const privileges = require('../../privileges');
var user = require('../../user');
var posts = require('../../posts');
var plugins = require('../../plugins');
var meta = require('../../meta');
var accountHelpers = require('./helpers');
var helpers = require('../helpers');
var messaging = require('../../messaging');
var translator = require('../../translator');
var utils = require('../../utils');

var profileController = module.exports;

profileController.get = function (req, res, callback) {
	var lowercaseSlug = req.params.userslug.toLowerCase();

	if (req.params.userslug !== lowercaseSlug) {
		if (res.locals.isAPI) {
			req.params.userslug = lowercaseSlug;
		} else {
			return res.redirect(nconf.get('relative_path') + '/user/' + lowercaseSlug);
		}
	}

	var userData;
	async.waterfall([
		function (next) {
			accountHelpers.getUserDataByUserSlug(req.params.userslug, req.uid, next);
		},
		function (_userData, next) {
			if (!_userData) {
				return callback();
			}
			userData = _userData;

			if (req.uid >= 0) {
				req.session.uids_viewed = req.session.uids_viewed || {};

				if (req.uid !== userData.uid && (!req.session.uids_viewed[userData.uid] || req.session.uids_viewed[userData.uid] < Date.now() - 3600000)) {
					user.incrementUserFieldBy(userData.uid, 'profileviews', 1);
					req.session.uids_viewed[userData.uid] = Date.now();
				}
			}

			async.parallel({
				hasPrivateChat: function (next) {
					messaging.hasPrivateChat(req.uid, userData.uid, next);
				},
				latestPosts: function (next) {
					getLatestPosts(req.uid, userData, next);
				},
				bestPosts: function (next) {
					getBestPosts(req.uid, userData, next);
				},
				signature: function (next) {
					posts.parseSignature(userData, req.uid, next);
				},
				aboutme: function (next) {
					if (userData.aboutme) {
						plugins.fireHook('filter:parse.aboutme', userData.aboutme, next);
					} else {
						next();
					}
				},
			}, next);
		},
		function (results, next) {
			if (meta.config['reputation:disabled']) {
				delete userData.reputation;
			}

			userData.posts = results.latestPosts; // for backwards compat.
			userData.latestPosts = results.latestPosts;
			userData.bestPosts = results.bestPosts;
			userData.hasPrivateChat = results.hasPrivateChat;
			userData.aboutme = translator.escape(results.aboutme);
			userData.breadcrumbs = helpers.buildBreadcrumbs([{ text: userData.username }]);
			userData.title = userData.username;
			userData.allowCoverPicture = !userData.isSelf || userData.reputation >= (meta.config['min:rep:cover-picture'] || 0);

			if (!userData.profileviews) {
				userData.profileviews = 1;
			}

			addMetaTags(res, userData);

			userData.selectedGroup = userData.groups.filter(function (group) {
				return group && userData.groupTitleArray.includes(group.name);
			});

			plugins.fireHook('filter:user.account', { userData: userData, uid: req.uid }, next);
		},
		function (results) {
			res.render('account/profile', results.userData);
		},
	], callback);
};

function getLatestPosts(callerUid, userData, callback) {
	async.waterfall([
		function (next) {
			db.getSortedSetRevRange('uid:' + userData.uid + ':posts', 0, 99, next);
		},
		function (pids, next) {
			getPosts(callerUid, pids, next);
		},
	], callback);
}

function getBestPosts(callerUid, userData, callback) {
	async.waterfall([
		function (next) {
			db.getSortedSetRevRange('uid:' + userData.uid + ':posts:votes', 0, 99, next);
		},
		function (pids, next) {
			getPosts(callerUid, pids, next);
		},
	], callback);
}

function getPosts(callerUid, pids, callback) {
	async.waterfall([
		function (next) {
			privileges.posts.filter('topics:read', pids, callerUid, next);
		},
		function (pids, next) {
			pids = pids.slice(0, 10);
			posts.getPostSummaryByPids(pids, callerUid, { stripTags: false }, next);
		},
	], callback);
}

function addMetaTags(res, userData) {
	var plainAboutMe = userData.aboutme ? utils.stripHTMLTags(utils.decodeHTMLEntities(userData.aboutme)) : '';
	res.locals.metaTags = [
		{
			name: 'title',
			content: userData.fullname || userData.username,
		},
		{
			name: 'description',
			content: plainAboutMe,
		},
		{
			property: 'og:title',
			content: userData.fullname || userData.username,
		},
		{
			property: 'og:description',
			content: plainAboutMe,
		},
	];

	if (userData.picture) {
		res.locals.metaTags.push(
			{
				property: 'og:image',
				content: userData.picture,
				noEscape: true,
			},
			{
				property: 'og:image:url',
				content: userData.picture,
				noEscape: true,
			}
		);
	}
}
