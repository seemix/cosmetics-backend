import { messages } from './localization'

export const verifyEmail = (locale: 'ru' | 'ro', name: string, url: string) => {
  return `<!-- Content -->
            <tr>
              <td
                colspan="2"
                style="
                  padding:24px;
                  font-size:15px;
                  line-height:1.6;
                  color:#333333;
                  letter-spacing:0.3px;
                  background-color:#fcfbfb;
                "
              >
                <!-- Main content -->
                <h3>${messages.dear[locale]} ${name}!</h3>
                <p>${messages.successRegistration[locale]} Next Level Shop.</p>
                <p>${messages.accountActivation[locale]} </p></br>
               👉 <a href="${url}">${url}</a>
              </td>
            </tr>
`
}