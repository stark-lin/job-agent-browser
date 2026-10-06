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
    pageNavigation: 'Page navigation', openSettings: 'Open Settings'
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
  errors: {
    unknownPage: 'Unknown application page.', providersUnavailable: 'Application providers are unavailable.',
    actionFailed: 'Unable to complete the action.',
    storageTitle: 'Storage unavailable',
    storageMessage: 'The database could not be opened or migrated. Your database has not been reset.',
    navigationInput: 'Navigation input must be text.', visibilityInput: 'Browser visibility must be a boolean.',
    presentationInput: 'Browser presentation must identify a tab and target.', tabIdInput: 'Tab ID must be text.',
    browserNotReady: 'Browser is not ready.', untrustedSender: 'Untrusted IPC sender.',
    emptyAddress: 'Enter a URL or search term.', unsupportedProtocol: 'Only HTTP and HTTPS pages can be opened.',
    invalidAddress: 'Enter a valid web address.', tabUnavailable: 'Tab is no longer available.',
    loadFailed: 'Unable to load this page. Check the address and your connection.',
    historySyncFailed: 'Unable to synchronize browser history.'
  }
} as const
