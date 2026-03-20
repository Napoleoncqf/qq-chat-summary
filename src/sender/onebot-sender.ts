import axios from 'axios';
import fs from 'fs';
import { logger } from '../utils/logger';

export class OneBotSender {
  private httpUrl: string;
  private token: string;

  constructor(httpUrl: string, token: string = '') {
    this.httpUrl = httpUrl.replace(/\/$/, '');
    this.token = token;
  }

  async sendGroupImage(groupId: string, imagePath: string): Promise<boolean> {
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64 = imageBuffer.toString('base64');

      const response = await axios.post(
        `${this.httpUrl}/send_group_msg`,
        {
          group_id: Number(groupId),
          message: [
            {
              type: 'image',
              data: {
                file: `base64://${base64}`,
              },
            },
          ],
        },
        {
          headers: this.getHeaders(),
          timeout: 30000,
        }
      );

      if (response.data?.retcode === 0) {
        logger.info('Sender', `Image sent to group ${groupId}`);
        return true;
      } else {
        logger.error('Sender', `Send failed: ${JSON.stringify(response.data)}`);
        return false;
      }
    } catch (err) {
      logger.error('Sender', `Failed to send image to group ${groupId}`, err);
      return false;
    }
  }

  async sendGroupText(groupId: string, text: string): Promise<boolean> {
    try {
      const response = await axios.post(
        `${this.httpUrl}/send_group_msg`,
        {
          group_id: Number(groupId),
          message: [
            {
              type: 'text',
              data: { text },
            },
          ],
        },
        {
          headers: this.getHeaders(),
          timeout: 15000,
        }
      );

      if (response.data?.retcode === 0) {
        logger.info('Sender', `Text sent to group ${groupId}`);
        return true;
      } else {
        logger.error('Sender', `Send text failed: ${JSON.stringify(response.data)}`);
        return false;
      }
    } catch (err) {
      logger.error('Sender', `Failed to send text to group ${groupId}`, err);
      return false;
    }
  }

  async sendPrivateImage(userId: string, imagePath: string): Promise<boolean> {
    try {
      const imageBuffer = fs.readFileSync(imagePath);
      const base64 = imageBuffer.toString('base64');

      const response = await axios.post(
        `${this.httpUrl}/send_private_msg`,
        {
          user_id: Number(userId),
          message: [
            {
              type: 'image',
              data: {
                file: `base64://${base64}`,
              },
            },
          ],
        },
        {
          headers: this.getHeaders(),
          timeout: 30000,
        }
      );

      if (response.data?.retcode === 0) {
        logger.info('Sender', `Image sent to user ${userId}`);
        return true;
      } else {
        logger.error('Sender', `Send private failed: ${JSON.stringify(response.data)}`);
        return false;
      }
    } catch (err) {
      logger.error('Sender', `Failed to send image to user ${userId}`, err);
      return false;
    }
  }

  async sendPrivateImages(userId: string, imagePaths: string[]): Promise<boolean> {
    let allSuccess = true;
    for (const imgPath of imagePaths) {
      const success = await this.sendPrivateImage(userId, imgPath);
      if (!success) allSuccess = false;
      if (imagePaths.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    return allSuccess;
  }

  async sendImages(groupId: string, imagePaths: string[]): Promise<boolean> {
    let allSuccess = true;
    for (const imgPath of imagePaths) {
      const success = await this.sendGroupImage(groupId, imgPath);
      if (!success) allSuccess = false;
      // Small delay between images to avoid rate limiting
      if (imagePaths.length > 1) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    return allSuccess;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }
}
