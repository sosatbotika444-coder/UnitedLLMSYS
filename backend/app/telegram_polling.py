from __future__ import annotations

import asyncio
import logging

from aiogram import Bot, Dispatcher, Router
from aiogram.filters import Command, CommandStart
from aiogram.types import BotCommand, BufferedInputFile, Message

from app.config import get_settings
from app.database import SessionLocal
from app.telegram_bot import (
    WIZARD_STEPS,
    bot_enabled,
    build_route_bundle,
    clean_text,
    consume_step_input,
    get_or_create_profile,
    help_message,
    parse_route_pair,
    profile_summary,
    prompt_for_step,
    reset_wizard,
    start_route_wizard,
)


settings = get_settings()
router = Router(name="telegram-polling")
dispatcher = Dispatcher()
dispatcher.include_router(router)
logger = logging.getLogger(__name__)
MAX_MESSAGE_LENGTH = 4000


def _message_chunks(text: str, size: int = MAX_MESSAGE_LENGTH) -> list[str]:
    clean = str(text or "").strip()
    if not clean:
        return []
    return [clean[index:index + size] for index in range(0, len(clean), size)]


def _user_payload(message: Message) -> dict:
    user = message.from_user
    return {
        "id": user.id if user else "",
        "username": user.username if user else "",
        "first_name": user.first_name if user else "",
        "last_name": user.last_name if user else "",
    }


async def _deliver_route_bundle(bot: Bot, chat_id: int, profile_id: int) -> None:
    await bot.send_chat_action(chat_id=chat_id, action="typing")
    try:
        bundle = await asyncio.to_thread(build_route_bundle, profile_id)
    except Exception as exc:
        await bot.send_message(chat_id=chat_id, text=f"{exc}\n\nSend /route and try again.")
        return

    await bot.send_chat_action(chat_id=chat_id, action="upload_photo")
    await bot.send_photo(
        chat_id=chat_id,
        photo=BufferedInputFile(bundle.image_bytes, filename="route-plan.png"),
        caption=(bundle.caption or "")[:1024],
    )
    for chunk in _message_chunks(bundle.details):
        await bot.send_message(chat_id=chat_id, text=chunk)


@router.message(CommandStart())
async def command_start(message: Message) -> None:
    if message.chat.type != "private":
        return
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        reset_wizard(db, profile)
        response = help_message(profile)
    await message.answer(response)


@router.message(Command("help"))
async def command_help(message: Message) -> None:
    if message.chat.type != "private":
        return
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        response = help_message(profile)
    await message.answer(response)


@router.message(Command("profile"))
async def command_profile(message: Message) -> None:
    if message.chat.type != "private":
        return
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        response = profile_summary(profile)
    await message.answer(response)


@router.message(Command("reset"))
async def command_reset(message: Message) -> None:
    if message.chat.type != "private":
        return
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        reset_wizard(db, profile)
    await message.answer("Current wizard cleared. Send /route to start again.")


@router.message(Command("route"))
async def command_route(message: Message) -> None:
    if message.chat.type != "private":
        return
    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        start_route_wizard(db, profile)
        response = (
            "Route wizard started.\n"
            "Send `A -> B` or go step by step.\n\n"
            + prompt_for_step(profile, "origin")
        )
    await message.answer(response)


@router.message()
async def route_message(message: Message, bot: Bot) -> None:
    if message.chat.type != "private":
        return

    text = clean_text(message.text)
    if not text:
        return

    response = ""
    should_build = False
    profile_id = 0

    with SessionLocal() as db:
        profile = get_or_create_profile(db, str(message.chat.id), _user_payload(message))
        profile_id = int(profile.id)

        if profile.active_step == "building":
            response = "A route is already building. Wait for the result or send /reset."
        else:
            quick_route = parse_route_pair(text)
            if quick_route:
                origin, destination = quick_route
                profile.pending_payload = {"origin": origin, "destination": destination}
                profile.active_step = "mpg"
                db.commit()
                db.refresh(profile)
                response = "Saved route points.\n" + prompt_for_step(profile, "mpg")
            elif profile.active_step and profile.active_step in WIZARD_STEPS:
                ok, error_text = consume_step_input(db, profile, text)
                if not ok:
                    response = error_text or "Value is invalid. Try again."
                elif profile.active_step == "building":
                    response = "Building smart route and fuel plan. Please wait..."
                    should_build = True
                else:
                    response = prompt_for_step(profile, profile.active_step)
            else:
                response = "Send /route to start the wizard, or send `Point A -> Point B`."

    await message.answer(response)
    if should_build:
        await _deliver_route_bundle(bot, message.chat.id, profile_id)


async def _set_bot_commands(bot: Bot) -> None:
    await bot.set_my_commands(
        [
            BotCommand(command="start", description="Open help"),
            BotCommand(command="route", description="Build smart route"),
            BotCommand(command="profile", description="Show saved truck profile"),
            BotCommand(command="reset", description="Reset current wizard"),
            BotCommand(command="help", description="Show help"),
        ]
    )


async def run_polling_bot() -> None:
    if not bot_enabled():
        raise RuntimeError("Telegram bot is disabled. Set TELEGRAM_BOT_ENABLED=true and TELEGRAM_BOT_TOKEN.")

    bot = Bot(
        token=settings.telegram_bot_token,
    )
    await bot.delete_webhook(drop_pending_updates=bool(settings.telegram_polling_drop_pending_updates))
    await _set_bot_commands(bot)
    logger.info("Starting aiogram polling bot")
    await dispatcher.start_polling(bot, allowed_updates=["message"])
