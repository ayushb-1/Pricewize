import { NextResponse } from "next/server";

import {
  getLowestPrice,
  getHighestPrice,
  getAveragePrice,
  getEmailNotifType,
} from "@/lib/utils";
import { connectToDB } from "@/lib/mongoose";
import Product from "@/lib/models/product.model";
import { scrapeAmazonProduct } from "@/lib/scraper";
import { generateEmailBody, sendEmail } from "@/lib/nodemailer";

export const maxDuration = 60; // Set to 60 seconds to comply with Vercel's hobby plan
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: Request) {
  try {
    connectToDB();

    const products = await Product.find({});
    if (!products) throw new Error("No products fetched");

    // Process products in chunks
    const chunkSize = 10; // Adjust this number based on the time required per product
    for (let i = 0; i < products.length; i += chunkSize) {
      const productChunk = products.slice(i, i + chunkSize);

      await Promise.all(
        productChunk.map(async (currentProduct) => {
          // Scrape product
          const scrapedProduct = await scrapeAmazonProduct(currentProduct.url);

          if (!scrapedProduct) return;

          const updatedPriceHistory = [
            ...currentProduct.priceHistory,
            { price: scrapedProduct.currentPrice },
          ];

          const product = {
            ...scrapedProduct,
            priceHistory: updatedPriceHistory,
            lowestPrice: getLowestPrice(updatedPriceHistory),
            highestPrice: getHighestPrice(updatedPriceHistory),
            averagePrice: getAveragePrice(updatedPriceHistory),
          };

          // Update Products in DB
          const updatedProduct = await Product.findOneAndUpdate(
            { url: product.url },
            product
          );

          // Check each product's status and send email accordingly
          const emailNotifType = getEmailNotifType(
            scrapedProduct,
            currentProduct
          );

          if (emailNotifType && updatedProduct.users.length > 0) {
            const productInfo = {
              title: updatedProduct.title,
              url: updatedProduct.url,
            };

            // Construct email content
            const emailContent = await generateEmailBody(
              productInfo,
              emailNotifType
            );

            // Get array of user emails
            const userEmails = updatedProduct.users.map(
              (user: any) => user.email
            );

            // Send email notification
            await sendEmail(emailContent, userEmails);
          }

          return updatedProduct;
        })
      );
    }

    return NextResponse.json({
      message: "Ok",
      data: "Products updated successfully",
    });
  } catch (error: any) {
    throw new Error(`Failed to get all products: ${error.message}`);
  }
}
