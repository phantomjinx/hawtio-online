import React from 'react'
import ReactDOM from 'react-dom/client'
import { configManager, hawtio, HawtioInitialization, TaskState } from '@hawtio/react/init'
import { OAuth } from './OAuth'

// Hawtio itself creates and tracks initialization tasks, but we can add our own.
configManager.initItem('Loading UI', TaskState.started, 'config')

// Create root for rendering React components. More React components can be rendered in single root.
const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement)

// Basic UI that shows initialization progress without depending on PatternFly.
// It is imported and rendered in fully synchronous way.
root.render(<HawtioInitialization verbose={true} />)

// Configure the console
configManager.addProductInfo('OAuth Test App', '1.0.0')

// Initialization phase is finished. We could already bootstrap Hawtio, but this is the stage, where we register
// built-in Hawtio plugins.
// From now on, we use dynamic `import()` instead of static `import` and we can import _full_ Hawtio packages:
// '@hawtio/react' and '@hawtio/react/ui'
import('@hawtio/react').then(async m => {
  m.Logger.setLevel(m.Logger.DEBUG)

  await import('@hawtio/online-oauth').then(mod => {
    // To be removed post-development / pre-production
    mod.log.log('Logging Level set to', m.Logger.getLevel())

    // Load OpenShift OAuth plugin first
    mod.onlineOAuth()
  })

  // hawtio.bootstrap() will wait for all init items to be ready, so we have to finish 'loading'
  // stage of UI. UI will be rendered after bootstrap() returned promise is resolved
  configManager.initItem('Loading UI', TaskState.finished, 'config')

  // finally, after we've registered all custom and built-in plugins, we can proceed to the final stage:
  //  - bootstrap(), which finishes internal configuration, applies branding and loads all registered plugins11111
  //  - rendering of <Hawtio> React component after bootstrap() finishes
  m.hawtio.bootstrap().then(() => {
    import('@hawtio/react/ui').then(m => {
      root.render(
        <React.StrictMode>
          <OAuth />
        </React.StrictMode>,
      )
    })
  })
})
