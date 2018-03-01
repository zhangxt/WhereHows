import Controller from '@ember/controller';
import { computed, set, get, setProperties, getProperties, getWithDefault } from '@ember/object';
import { debug } from '@ember/debug';
import $ from 'jquery';
import { inject as service } from '@ember/service';
import { run, scheduleOnce } from '@ember/runloop';
import {
  datasetComplianceUrlById,
  createDatasetComment,
  readDatasetComments,
  deleteDatasetComment,
  updateDatasetComment
} from 'wherehows-web/utils/api';
import { encodeUrn } from 'wherehows-web/utils/validators/urn';
import { updateDatasetDeprecation } from 'wherehows-web/utils/api/datasets/properties';
import { readDatasetOwners, updateDatasetOwners } from 'wherehows-web/utils/api/datasets/owners';
import { Tabs } from 'wherehows-web/constants/datasets/shared';
import { action } from 'ember-decorators/object';

const { post, getJSON } = $;

// gradual refactor into es class, hence extends EmberObject instance
export default class extends Controller.extend({
  queryParams: ['urn'],
  /**
   * Reference to the application notifications Service
   * @type {Ember.Service}
   */
  notifications: service(),

  isPinot: computed('model.source', function() {
    var model = this.get('model');
    if (model) {
      if (model.source) {
        return model.source.toLowerCase() == 'pinot';
      }
    }
    return false;
  }),
  isHDFS: computed('model.urn', function() {
    var model = this.get('model');
    if (model) {
      if (model.urn) {
        return model.urn.substring(0, 7) == 'hdfs://';
      }
    }
    return false;
  }),
  isSFDC: computed('model.source', function() {
    var model = this.get('model');
    if (model) {
      if (model.source) {
        return model.source.toLowerCase() == 'salesforce';
      }
    }
    return false;
  }),
  lineageUrl: computed('model.id', function() {
    var model = this.get('model');
    if (model) {
      if (model.id) {
        return '/lineage/dataset/' + model.id;
      }
    }
    return '';
  }),
  schemaHistoryUrl: computed('model.id', function() {
    var model = this.get('model');
    if (model) {
      if (model.id) {
        return '/schemaHistory#/schemas/' + model.id;
      }
    }
    return '';
  }),

  refreshVersions: function(dbId) {
    var model = this.get('model');
    if (!model || !model.id) {
      return;
    }
    var versionUrl = '/api/v1/datasets/' + model.id + '/versions/db/' + dbId;
    $.get(versionUrl, data => {
      if (data && data.status == 'ok' && data.versions && data.versions.length > 0) {
        this.set('hasversions', true);
        this.set('versions', data.versions);
        this.set('latestVersion', data.versions[0]);
        this.changeVersion(data.versions[0]);
      } else {
        this.set('hasversions', false);
        this.set('currentVersion', '0');
        this.set('latestVersion', '0');
      }
    });
  },
  changeVersion: function(version) {
    _this = this;
    var currentVersion = _this.get('currentVersion');
    var latestVersion = _this.get('latestVersion');
    if (currentVersion == version) {
      return;
    }
    var objs = $('.version-btn');
    if (objs && objs.length > 0) {
      for (var i = 0; i < objs.length; i++) {
        $(objs[i]).removeClass('btn-default');
        $(objs[i]).removeClass('btn-primary');
        if (version == $(objs[i]).attr('data-value')) {
          $(objs[i]).addClass('btn-primary');
        } else {
          $(objs[i]).addClass('btn-default');
        }
      }
    }
    var model = this.get('model');
    if (version != latestVersion) {
      if (!model || !model.id) {
        return;
      }
      var schemaUrl = '/api/v1/datasets/' + model.id + '/schema/' + version;
      $.get(schemaUrl, function(data) {
        if (data && data.status == 'ok') {
          setTimeout(function() {
            $('#json-viewer').JSONView(JSON.parse(data.schema_text));
          }, 500);
        }
      });
    }

    _this.set('currentVersion', version);
  },

  async handleDatasetComment(strategy, ...args) {
    const { datasetId: id, 'notifications.notify': notify } = getProperties(this, [
      'datasetId',
      'notifications.notify'
    ]);

    const action = {
      create: createDatasetComment.bind(null, id),
      destroy: deleteDatasetComment.bind(null, id),
      modify: updateDatasetComment.bind(null, id)
    }[strategy];

    try {
      await action(...args);
      notify('success', { content: 'Success!' });
      // refresh the list of comments if successful with updated response
      set(this, 'datasetComments', await readDatasetComments(id));

      return true;
    } catch (e) {
      notify('error', { content: e.message });
    }

    return false;
  },

  actions: {
    /**
     * Action handler creates a dataset comment with the type and text pas
     * @param {CommentTypeUnion} type the comment type
     * @param {string} text the text of the comment
     * @return {Promise.<boolean>} true if successful in creating the comment, false otherwise
     */
    async createDatasetComment({ type, text }) {
      return this.handleDatasetComment.call(this, 'create', { type, text });
    },

    /**
     * Deletes a comment from the current dataset
     * @param {number} commentId the id for the comment to be deleted
     * @return {Promise.<boolean>}
     */
    async destroyDatasetComment(commentId) {
      return this.handleDatasetComment.call(this, 'destroy', commentId);
    },

    /**
     * Updates a comment on the current dataset
     * @param commentId
     * @param updatedComment
     * @return {Promise.<boolean>}
     */
    async updateDatasetComment(commentId, updatedComment) {
      return this.handleDatasetComment.call(this, 'modify', commentId, updatedComment);
    },

    updateVersion: function(version) {
      this.changeVersion(version);
    },
    updateInstance: function(instance) {
      var currentInstance = this.get('currentInstance');
      var latestInstance = this.get('latestInstance');
      if (currentInstance == instance.dbId) {
        return;
      }
      var objs = $('.instance-btn');
      if (objs && objs.length > 0) {
        for (var i = 0; i < objs.length; i++) {
          $(objs[i]).removeClass('btn-default');
          $(objs[i]).removeClass('btn-primary');

          if (instance.dbCode == $(objs[i]).attr('data-value')) {
            $(objs[i]).addClass('btn-primary');
          } else {
            $(objs[i]).addClass('btn-default');
          }
        }
      }

      this.set('currentInstance', instance.dbId);
      this.refreshVersions(instance.dbId);
    }
  }
}) {
  /**
   * Enum of tab properties
   * @type {Tabs}
   */
  tabIds = Tabs;

  /**
   * The currently selected tab in view
   * @type {Tabs}
   */
  tabSelected;

  /**
   * Converts the uri on a model to a usable URN format
   * @type {ComputedProperty<string>}
   */
  encodedUrn = computed('model', function() {
    const { uri = '' } = get(this, 'model');
    return encodeUrn(uri);
  });

  constructor() {
    super(...arguments);
    this.tabSelected || (this.tabSelected = Tabs.Ownership);
  }

  /**
   * Handles user generated tab selection action by transitioning to specified route
   * @param {Tabs} tabSelected the currently selected tab
   */
  @action
  tabSelectionChanged(tabSelected) {
    // if the tab selection is same as current, noop
    return get(this, 'tabSelected') === tabSelected
      ? void 0
      : this.transitionToRoute(`datasets.dataset.${tabSelected}`, get(this, 'encodedUrn'));
  }
}
