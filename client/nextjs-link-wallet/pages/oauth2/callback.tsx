import { EthereumProvider } from '@walletconnect/ethereum-provider'
import axios, { isAxiosError } from 'axios'
import { headers } from 'next/dist/client/components/headers'
import { useRouter } from 'next/router'
import QRCode from 'qrcode.react'
import { useEffect, useRef, useState } from 'react'

type InitialData = {
  account: string
  chainId: number
}

const SERVER_TOKEN_ENDPOINT =
  process.env.SERVER_TOKEN_ENDPOINT ??
  'http://localhost:8080/oauth2/authorization-code/token'
const OIDC_CALLBACK_URL =
  process.env.OIDC_CALLBACK_URL ?? 'http://localhost:3000/oauth2/callback'
const SERVER_RONIN_NONCE_ENDPOINT =
  process.env.SERVER_RONIN_NONCE_ENDPOINT ??
  'http://localhost:8080/oauth2/ronin/fetch-nonce'
const SERVER_RONIN_TOKEN_ENDPOINT =
  process.env.SERVER_RONIN_TOKEN_ENDPOINT ??
  'http://localhost:8080/oauth2/ronin/token'

const WC_DEFAULT_PROJECT_ID = 'd2ef97836db7eb390bcb2c1e9847ecdc'
const WC_SUPPORTED_CHAIN_IDS = [2020, 2021, 2022]
const WC_RPC_MAP = {
  2020: 'https://api.roninchain.com/rpc',
  2021: 'https://saigon-testnet.roninchain.com/rpc',
  2022: 'https://hcm-devnet.skymavis.com/rpc',
}
const WC_SUPPORTED_METHODS = [
  'eth_accounts',
  'eth_requestAccounts',
  'eth_sendTransaction',
  'eth_sign',
  'personal_sign',
  'eth_signTypedData',
  'eth_signTypedData_v4',
  'eth_getFreeGasRequests',
  'wallet_initialData',
]

const generateSingingMessage = ({
  address,
  version = 1,
  chainId = 2020,
  nonce,
  issuedAt,
  expirationTime,
  notBefore,
}: {
  address: string
  version?: number
  chainId: number
  nonce: string
  issuedAt: string
  expirationTime: string
  notBefore: string
}) => {
  return `accounts.skymavis.com wants you to sign in with your Ronin account:
  ${address.replace('0x', 'ronin:').toLowerCase()}

  I accept the Terms of Use (https://axieinfinity.com/terms-of-use) and the Privacy Policy (https://axieinfinity.com/privacy-policy)

  URI: https://accounts.skymavis.com
  Version: ${version}
  Chain ID: ${chainId}
  Nonce: ${nonce}
  Issued At: ${issuedAt}
  Expiration Time: ${expirationTime}
  Not Before: ${notBefore}`
}

const openWallet = (uri: string) => {
  const universalLink = `roninwallet://auth-connect?uri=${encodeURIComponent(
    uri,
  )}`
  window.open(universalLink, '_self')
}

const Callback = () => {
  const router = useRouter()
  const { code } = router.query
  const [wallet, setWallet] = useState(null)
  const [token, setToken] = useState(null)
  const [error, setError] = useState(null)
  const [uri, setUri] = useState('')
  const providerRef = useRef<InstanceType<typeof EthereumProvider> | null>(null)

  const connectRoninWallet = async (): Promise<InitialData> => {
    const provider = await EthereumProvider.init({
      projectId: WC_DEFAULT_PROJECT_ID,
      chains: WC_SUPPORTED_CHAIN_IDS,
      rpcMap: WC_RPC_MAP,
      methods: WC_SUPPORTED_METHODS,
      metadata: {
        name: 'Sky Mavis Account',
        description: 'Connect to Ronin Wallet from Sky Mavis Account',
        icons: [],
        url: 'https://accounts.skymavis.com',
      },
      showQrModal: false,
      disableProviderPing: true,
    })

    providerRef.current = provider

    await provider.disconnect()

    provider.on('display_uri', (uri: string) => {
      setUri(uri)
    })

    await provider.enable()

    const initialData = await provider.request<InitialData>({
      method: 'wallet_initialData',
    })

    if (!initialData) {
      const [accounts, chainId] = await Promise.all([
        provider.request<string[]>({
          method: 'eth_accounts',
        }),
        provider.request<number>({
          method: 'eth_chainId',
        }),
      ])

      return {
        chainId,
        account: accounts?.[0],
      }
    }

    return initialData
  }

  const linkRoninWallet = async () => {
    try {
      const { chainId, account: address } = await connectRoninWallet()

      const {
        data: { nonce, issued_at, not_before, expiration_time },
      } = await axios({
        url: SERVER_RONIN_NONCE_ENDPOINT,
        params: {
          address,
        },
      })

      const message = generateSingingMessage({
        address,
        chainId,
        nonce,
        issuedAt: issued_at,
        notBefore: not_before,
        expirationTime: expiration_time,
      })

      if (!providerRef.current) return

      const signature = await providerRef.current.request<string>({
        method: 'personal_sign',
        params: [message, address],
      })

      // TODO: Call API to link wallet here
      // const { data } = await axios({
      //   url: SERVER_LINK_WALLET,
      //   method: 'POST',
      //   headers: {
      //     Authorization: `Bearer ${token}`,
      //   },
      //   data: {
      //     address,
      //     message,
      //     signature,
      //   },
      // })

      // setWallet(data.token)
    } catch (error: any) {
      if (isAxiosError(error)) {
        setError(error?.response?.data)
        return
      }

      setError(error?.message ?? error)
    }
  }

  const exchangeToken = async () => {
    try {
      if (!code) return

      const { data } = await axios({
        url: SERVER_TOKEN_ENDPOINT,
        method: 'POST',
        data: {
          code,
          redirect_uri: OIDC_CALLBACK_URL,
        },
      })

      setToken(data)
    } catch (error: any) {
      if (isAxiosError(error)) {
        setError(error?.response?.data)
        return
      }

      setError(error?.message ?? error)
    }
  }

  useEffect(() => {
    if (code) exchangeToken()
  }, [code])

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        marginTop: 100,
      }}
    >
      {(() => {
        if (error)
          return (
            <>
              <h1>Something went wrong!</h1>
              <pre
                style={{
                  whiteSpace: 'pre-wrap',
                  width: 600,
                  overflow: 'auto',
                }}
              >
                {JSON.stringify(error, null, 2)}
              </pre>
            </>
          )

        if (token)
          return (
            <>
              <h1>Login successful!</h1>
              <pre
                style={{ whiteSpace: 'pre-wrap', width: 600, overflow: 'auto' }}
              >
                {JSON.stringify(token, null, 2)}
              </pre>

              <h1>Link Ronin Wallet</h1>
              {wallet ? (
                <>
                  <h2>Link successful!</h2>
                  <pre
                    style={{
                      whiteSpace: 'pre-wrap',
                      width: 600,
                      overflow: 'auto',
                      marginBottom: 40,
                    }}
                  >
                    {JSON.stringify(token, null, 2)}
                  </pre>
                </>
              ) : (
                <>
                  <button
                    style={{
                      padding: '12px 32px',
                      marginBottom: 12,
                      borderRadius: 8,
                      border: 'none',
                      cursor: 'pointer',
                    }}
                    onClick={linkRoninWallet}
                  >
                    Link
                  </button>
                  {uri && <QRCode value={uri} size={178} />}
                </>
              )}
            </>
          )
      })()}
    </div>
  )
}

export default Callback