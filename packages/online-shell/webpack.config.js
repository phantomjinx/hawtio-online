const webpack = require('webpack')
const WebpackDevServer = require('webpack-dev-server')
const DotenvPlugin = require('dotenv-webpack')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const InterpolateHtmlPlugin = require('interpolate-html-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')
const TsconfigPathsPlugin = require('tsconfig-paths-webpack-plugin')
const { hawtioBackend } = require('@hawtio/backend-middleware')
const path = require('path')
const dotenv = require('dotenv')
const { dependencies } = require('./package.json')

// this will update the process.env with environment variables in .env file
dotenv.config( { path: path.join(__dirname, '.env') } )

module.exports = () => {

  const master_uri = process.env.CLUSTER_MASTER
  if (!master_uri) {
    console.error('The CLUSTER_MASTER environment variable must be set!')
    process.exit(1)
  }

  const namespace = process.env.CLUSTER_NAMESPACE || 'hawtio-dev'
  const mode = process.env.HAWTIO_MODE || 'cluster'
  const clientId = process.env.OAUTH_CLIENT_ID
  if (!clientId) {
    console.error("The OAUTH_CLIENT_ID must be set!")
    process.exit(1)
  }

  console.log('Using Cluster URL:', master_uri)
  console.log('Using Cluster Namespace:', namespace)
  console.log('Using Hawtio Cluster Mode:', mode)
  console.log('USing OAuth Client Id:', clientId)

  const kubeBase = master_uri
  const kube = new URL(kubeBase)
  const devPort = process.env.PORT || 2772
  const proxiedMaster = `http://localhost:${devPort}/master`

  return {
    mode: 'development',
    devtool: 'eval-source-map',
    module: {
      rules:[
        {
          test: /\.css$/,
          use: [ 'style-loader', 'css-loader' ]
        },
        {
          test: /\.js$/,
          enforce: "pre",
          use: ["source-map-loader"],
        },
        {
          test: /\.tsx?$/,
          use: {
            loader: 'ts-loader',
            options: {
              compilerOptions: {
                noEmit: false, // this option will solve the issue
              },
            }
          },
          exclude: /node_modules|\.d\.ts$/, // this line as well
        },
        {
          test: /\.(js)x?$/,
          exclude: /node_modules/,
          use: 'babel-loader',
        }
      ]
    },
    plugins: [
      new MiniCssExtractPlugin({
        // MiniCssExtractPlugin - Ignore order as otherwise conflicting order warning is raised
        ignoreOrder: true
      }),
      new DotenvPlugin({
          safe: true,
          allowEmptyValues: true,
          defaults: true,
          systemvars: true,
          ignoreStub: true,
        }),
      new webpack.container.ModuleFederationPlugin({
        name: 'app',
        filename: 'remoteEntry.js',
        exposes: {},
        shared: {
          ...dependencies,
          react: {
            singleton: true,
            requiredVersion: dependencies['react'],
          },
          'react-dom': {
            singleton: true,
            requiredVersion: dependencies['react-dom'],
          },
          'react-router-dom': {
            singleton: true,
            requiredVersion: dependencies['react-router-dom'],
          },
          '@hawtio/react': {
            singleton: true,
            requiredVersion: dependencies['@hawtio/react'],
          },
          '@hawtio/online-kubernetes-api': {
            singleton: true,
            // Hardcoding needed because it cannot handle yarn 'workspace:*' version
            requiredVersion: '^0.0.0',
          },
        },
      }),
      new HtmlWebpackPlugin({
        inject: true,
        template: path.resolve(__dirname, 'public', 'index.html'),
      }),
      new webpack.DefinePlugin({
       'process.env': JSON.stringify(process.env)
      })
    ],
    output : {
      path: path.resolve(__dirname, 'build'),

      // Set base path to /
      publicPath: '/',

      pathinfo: true,
      filename: 'static/js/bundle.js',
      chunkFilename: 'static/js/[name].chunk.js',
      assetModuleFilename: 'static/media/[name].[hash][ext]'
    },
    ignoreWarnings: [
      // For suppressing sourcemap warnings coming from some dependencies
      /Failed to parse source map/
    ],
    resolve: {
      modules: [path.resolve(__dirname, 'node_modules'), path.resolve(__dirname, '../../node_modules')],
      extensions: ['.js', '.ts', '.tsx', '.jsx'],
      alias: {
        'react-native': 'react-native-web',
        src: path.resolve(__dirname, 'src')
      },
      plugins: [
        new TsconfigPathsPlugin({
          configFile: path.resolve(__dirname, './tsconfig.json'),
        }),
      ],
      symlinks: false,
      cacheWithContext: false,
      fallback: {
        os: require.resolve('os-browserify'),
        path: require.resolve('path-browserify'),
        process: require.resolve('process/browser'),
        url: require.resolve('url/'),
      }
    },
    devServer: {
      compress: true,
      liveReload: true,
      port: devPort,

      // Pushes any 404 page responses back to showing index.html
      historyApiFallback: true,

      /*
       * Proxy to bring the cluster into the app as a redirect.
       * Avoids issues with CORS
       * Note: target must be up and connectable. Otherwise an error is
       *       thrown by the proxy but with an incorrect error message with
       *       the original host address in it rather than the target
       */
      proxy: {
        '/master': {
          target: master_uri,
          pathRewrite: { '^/master': '' },
          secure: false,
          ws: true,
        },
      },

      static: {
        directory: path.join(__dirname, 'public'),
      },

      setupMiddlewares: (middlewares, devServer) => {
        /*
         * Function to construct the config.json file
         * and make it available for authentication
         */
        const osconsole = (_, res) => {
          const oscConfig = {
            master_uri: proxiedMaster,
            hawtio: {
              mode: mode,
            },
          }

          /*
           * The oauth_client_id *must* be the same as the name of an
           * OAuthClient resource added to the cluster, eg.
           *
           * apiVersion: oauth.openshift.io/v1
           * grantMethod: auto
           * kind: OAuthClient
           * metadata:
           *   annotations:
           *     kubectl.kubernetes.io/last-applied-configuration: |
           *       {"apiVersion":"oauth.openshift.io/v1","grantMethod":"auto","kind":"OAuthClient","metadata":{"annotations":{},"name":"hawtio-online-dev"},"redirectURIs":["http://localhost:2772","http://localhost:2772/online","http://localhost:8080"]}
           *   name: hawtio-online-dev
           * redirectURIs:
           * - http://localhost:2772
           * - http://localhost:2772/online
           * - http://localhost:8080
           */
          switch (mode) {
            case 'namespace':
              oscConfig.hawtio.namespace = namespace
              oscConfig.openshift = {
                oauth_metadata_uri: `${proxiedMaster}/.well-known/oauth-authorization-server`,
                oauth_client_id: clientId,
                scope: `user:info user:check-access user:full`,
                cluster_version: '4.11.0',
              }
              break
            case 'cluster':
              oscConfig.openshift = {
                oauth_metadata_uri: `${proxiedMaster}/.well-known/oauth-authorization-server`,
                oauth_client_id: `hawtio-online-dev`,
                scope: `user:info user:check-access user:full`,
                cluster_version: '4.11.0',
              }
              break
            default:
              console.error('Invalid value for the Hawtio Online mode, must be one of [cluster, namespace]')
              process.exit(1)
          }

          res.set('Content-Type', 'application/javascript')
          res.send(JSON.stringify(oscConfig))
        }

        const username = 'developer'
        const login = false
        const proxyEnabled = true

        // Keycloak
        const keycloakEnabled = false
        const keycloakClientConfig = {
          realm: 'hawtio-demo',
          clientId: 'hawtio-client',
          url: 'http://localhost:18080/',
          jaas: false,
          pkceMethod: 'S256',
        }

        devServer.app.get('/osconsole/config.json', osconsole)
        devServer.app.get('/keycloak/enabled', (_, res) => res.send(String(keycloakEnabled)))
        devServer.app.get('/proxy/enabled', (_, res) => res.send(String(proxyEnabled)))

        // Hawtio backend API mock
        devServer.app.get('/hawtio/user', (_, res) => res.send(`"${username}"`))
        devServer.app.get('/hawtio/plugin', (_, res) => res.send(JSON.stringify(plugin)))
        devServer.app.get('/hawtio/keycloak/client-config', (_, res) => res.send(JSON.stringify(keycloakClientConfig)))
        devServer.app.get('/hawtio/keycloak/validate-subject-matches', (_, res) => res.send('true'))
        devServer.app.get('/hawtio/auth/logout', (_, res) => res.redirect('/hawtio/login'))
        devServer.app.post('/hawtio/auth/login', (_, res) => res.send(String(login)))

        middlewares.push({
          name: 'hawtio-backend',
          path: '/proxy',
          middleware: hawtioBackend({
            // Uncomment it if you want to see debug log for Hawtio backend
            logLevel: 'debug',
          }),
        })

        return middlewares
      }
    }
  }
}