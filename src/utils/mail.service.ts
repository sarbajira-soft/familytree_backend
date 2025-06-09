import * as nodemailer from 'nodemailer';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MailService {
  private transporter;

  constructor() {
    this.transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.NODEMAILER_USERNAME,
        pass: process.env.NODEMAILER_PASSWORD,
      },
    });
  }

 async sendPasswordResetOtp(email: string, otp: string): Promise<void> {
    const mailOptions = {
      from: `"${process.env.APP_NAME}" <${process.env.NODEMAILER_FROM}>`,
      to: email,
      subject: 'Password Reset OTP',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Password Reset Request</h2>
          <p>Your OTP for password reset is:</p>
          <div style="background: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="margin: 0; color: #2c3e50;">${otp}</h1>
          </div>
          <p>This OTP is valid for 15 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #777;">© ${new Date().getFullYear()} ${process.env.APP_NAME}. All rights reserved.</p>
        </div>
      `,
    };

    try {
      await this.transporter.sendMail(mailOptions);
    } catch (error) {
      console.error('Error sending email:', error);
      throw new Error('Failed to send OTP email');
    }
  }

  // You can also add this similar method for verification OTPs
  async sendVerificationOtp(email: string, otp: string): Promise<void> {
    const mailOptions = {
      from: `"${process.env.APP_NAME}" <${process.env.NODEMAILER_FROM}>`,
      to: email,
      subject: 'Email Verification OTP',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Verify Your Email</h2>
          <p>Your verification OTP is:</p>
          <div style="background: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
            <h1 style="margin: 0; color: #2c3e50;">${otp}</h1>
          </div>
          <p>This OTP is valid for 15 minutes.</p>
          <p>If you didn't request this, please ignore this email.</p>
        </div>
      `,
    };

    await this.transporter.sendMail(mailOptions);
  }

  async sendWelcomeEmail(email: string, name: string, username: string, password: string): Promise<void> {
    const mailOptions = {
      from: `"${process.env.APP_NAME}" <${process.env.NODEMAILER_FROM}>`,
      to: email,
      subject: 'Welcome to Our Family Platform!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2 style="color: #333;">Hi ${name}, welcome aboard!</h2>
          <p>We're excited to have you as a part of our family system.</p>
          <p><strong>Your login credentials:</strong></p>
          <ul style="background: #f9f9f9; padding: 15px; list-style: none;">
            <li><strong>Username:</strong> ${username}</li>
            <li><strong>Password:</strong> ${password}</li>
          </ul>
          <p>Please log in and complete your profile if necessary.</p>
          <p>If you didn’t register, please ignore this email.</p>
          <br />
          <p>— ${process.env.APP_NAME} Team</p>
        </div>
      `,
    };

    await this.transporter.sendMail(mailOptions);
  }

}
