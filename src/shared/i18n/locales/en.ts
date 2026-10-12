/** Application-owned copy. Keep complete sentences so translations can reorder words. */
export const en = {
  app: {
    title: 'Job Agent Browser',
    loadingWorkspace: 'Loading workspace…'
  },
  navigation: {
    pages: {
      home: 'Home', find: 'Find Jobs', resume: 'Tailor Resume', interview: 'Interview Prep',
      applications: 'Applications', inbox: 'Inbox', profile: 'My Profile',
      browser: 'Browser', ai: 'Ask AI', settings: 'Settings'
    },
    back: 'Back', home: 'Home', forward: 'Forward',
    goHome: 'Go home', goBack: 'Go back', goForward: 'Go forward',
    pageNavigation: 'Page navigation', openSettings: 'Open Settings', workspaceNavigation: 'Workspace navigation',
    sections: { search: 'Job search', manage: 'Manage', tools: 'Tools' }
  },
  home: {
    brand: 'Job Browser',
    heading: 'What do you want to do?',
    subtitle: 'Everything you need for your job search, in one place.',
    footer: 'A focused workspace for the whole job search.',
    comingSoon: '{{label}} — Coming soon',
    cards: {
      find: 'Search and browse opportunities', resume: 'Adapt your resume to a role',
      interview: 'Prepare for a specific role', applications: 'Track applications in list or calendar view',
      inbox: 'Hiring emails and application updates', profile: 'Resume, experience and preferences',
      browser: 'Open the web freely', ai: 'Work with your job-search context',
      settings: 'AI, browser and app preferences'
    }
  },
  features: {
    comingSoon: 'Coming soon', notImplemented: 'This feature is not implemented yet.',
    descriptions: {
      find: 'Search and browse opportunities.', resume: 'Adapt your resume to a role.',
      interview: 'Prepare for a specific role.', applications: 'Track applications in list or calendar view.',
      inbox: 'Job-seeking email will open your configured webmail.',
      profile: 'Manage your resume, experience and preferences.',
      ai: 'Work with your job-search context.', settings: 'Configure AI, browser and application preferences.'
    }
  },
  browser: {
    tabs: 'Browser tabs', closeTab: 'Close tab', closeNamedTab: 'Close {{title}}', newTab: 'New tab',
    addressLabel: 'Search or enter URL', addressPlaceholder: 'Search or enter URL...',
    emptyHeading: 'Start exploring', emptyDescription: 'Search for anything or enter a web address above.'
  },
  inbox: {
    exit: 'Exit',
    configure: 'Connect your mailbox', configureHelp: 'Choose your webmail provider and address in Settings to open your mailbox here.',
    loadFailed: 'Unable to open your mailbox'
  },
  settings: {
    subtitle: 'Make this workspace yours. Preferences are stored on this device.',
    general: 'General', generalDescription: 'Choose the language for your workspace.',
    language: 'Language', appearance: 'Appearance', light: 'Light', lightHelp: 'Currently available in light appearance.',
    ai: 'AI provider', aiDescription: 'Manage your OpenAI API key on this device.',
    provider: 'Provider', apiKey: 'API key', keyPlaceholder: 'Enter a new API key',
    keyHelp: 'Encrypted using your operating system. Saved keys are never displayed here.',
    configured: 'Key saved', notConfigured: 'No key saved',
    aiPlanned: 'AI execution is coming soon. Saving a key does not make an API request or verify the key.',
    encryptionUnavailable: 'Secure key storage is unavailable on this device.',
    mailbox: 'Mailbox', mailboxDescription: 'Open your webmail directly from Inbox.',
    mailProvider: 'Email provider', none: 'Not configured', custom: 'Custom webmail',
    mailURL: 'Webmail URL', mailHelp: 'Use an HTTPS address without a username or password in the URL.',
    mailInvalid: 'Enter a valid HTTPS webmail URL without embedded credentials.',
    save: 'Save changes', saveKey: 'Save key', replaceKey: 'Replace key', deleteKey: 'Delete key',
    saving: 'Saving…', saved: 'Changes saved.', keySaved: 'Key saved securely.', keyDeleted: 'Key deleted.',
    deleteTitle: 'Delete the saved API key?', deleteDescription: 'You can add a new key later.', cancel: 'Cancel',
    unsaved: 'Unsaved changes', loading: 'Loading settings…', loadFailed: 'Settings could not be loaded.',
    saveFailed: 'Changes could not be saved. Your previous settings are preserved.', retry: 'Try again',
    discardTitle: 'Leave without saving?', discardDescription: 'Your unsaved settings will be discarded.',
    discard: 'Discard changes', stay: 'Keep editing',
    local: 'Stored locally', localDescription: 'Preferences and encrypted keys stay on this device. Website sign-ins are managed separately by the browser.'
  },
  errors: {
    unknownPage: 'Unknown application page.', providersUnavailable: 'Application providers are unavailable.',
    actionFailed: 'Unable to complete the action.',
    storageTitle: 'Storage unavailable',
    storageMessage: 'Local data or settings could not be opened. Your saved files have not been reset.',
    navigationInput: 'Navigation input must be text.', visibilityInput: 'Browser visibility must be a boolean.',
    presentationInput: 'Browser presentation must identify a tab and target.', tabIdInput: 'Tab ID must be text.',
    browserNotReady: 'Browser is not ready.', untrustedSender: 'Untrusted IPC sender.',
    emptyAddress: 'Enter a URL or search term.', unsupportedProtocol: 'Only HTTP and HTTPS pages can be opened.',
    invalidAddress: 'Enter a valid web address.', tabUnavailable: 'Tab is no longer available.',
    loadFailed: 'Unable to load this page. Check the address and your connection.',
    historySyncFailed: 'Unable to synchronize browser history.'
  }
} as const
